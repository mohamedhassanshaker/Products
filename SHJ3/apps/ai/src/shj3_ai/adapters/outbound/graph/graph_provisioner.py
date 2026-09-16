"""Tenant graph provisioning — RB-09 step 2, RB-10 reverse step 2, RB-11 check 5.

``shj3-ai`` is Neo4j's sole writer (ADR-0003), and the Kubernetes NetworkPolicy admits
Neo4j ingress from this service and the worker only, so this module is where a tenant's
graph objects are actually created and dropped. ``shj3-web`` reaches it through the
internal API rather than through a driver of its own.

What changed under ADR-0009, and why this file is shaped around it
-----------------------------------------------------------------
Under ADR-0002 a tenant was a Neo4j database, so provisioning was ``CREATE DATABASE`` and
de-provisioning was ``DROP DATABASE`` — two atomic acts, each carrying its own guarantee.
The Enterprise licence was declined, Community offers neither a database boundary nor
RBAC, and the tenant became a ``:Tenant_<slug>`` label plus a ``tenant_id`` property in one
shared database. Two consequences drive everything below:

* **Provisioning is now eight statements rather than one.** So it must be idempotent and
  resumable statement-by-statement — a failure at statement five is recovered by re-running,
  not by cleaning up. Every statement the builder emits carries ``IF NOT EXISTS``.

* **Erasure has no guarantee left, only a proof** (ADR-0009 rule 6). A batched
  ``DETACH DELETE`` is exactly the delete-by-filter ADR-0002 chose schema-per-tenant to
  avoid. So :meth:`GraphProvisioner.destroy` does not return once the delete has run; it
  returns an :class:`ErasureProof` and *refuses to report success* until both encodings
  count zero. That is the difference between "we deleted it" and "we can show that we
  deleted it", and it is the whole of the right-to-be-forgotten path at tenant scope.

The batching is not a performance choice either: an unbatched ``DETACH DELETE`` over a
large tenant builds a transaction bigger than the heap, and on a single Community instance
that takes the graph down for *every* government entity.

All Cypher comes from the builder in ``cypher_builder``. Nothing here composes a query
string — the ``no-raw-cypher`` gate permits Cypher in this package, but the isolation
argument (RISK-024) rests on the builder being the only producer of it, and one
introspection statement below is the single exception, discussed where it is defined.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, LiteralString, Protocol

from neo4j import AsyncDriver, AsyncGraphDatabase

from shj3_ai.adapters.outbound.graph.cypher_builder import (
    Query,
    SchemaStatement,
    TenantCypher,
    global_schema_statements,
)
from shj3_ai.domain.tenancy import TenantSlug

# How many times the batched delete may be re-driven before the residue is reported as a
# defect rather than as work still to do. `CALL {} IN TRANSACTIONS` already loops over
# everything it matched, so a second pass is only needed if nodes were written while it
# ran; a third means something is still writing to a tenant being erased.
_MAX_DELETE_PASSES = 5

# The one introspection statement in this module.
#
# `SHOW INDEXES` has no builder method and cannot have one: `Query` refuses to construct a
# statement that does not carry both tenant encodings (ADR-0009's dual encoding), and an
# index listing has no rows to scope — the same reason `SchemaStatement` exists as a
# separate type for DDL. The names it filters on are bound as a parameter, not
# interpolated, so the tenant value never reaches identifier position here.
_SHOW_TENANT_INDEXES: LiteralString = (
    "SHOW INDEXES YIELD name WHERE name IN $names RETURN count(name) AS present"
)


class GraphStatementExecutor(Protocol):
    """The narrow slice of Neo4j this module needs.

    A protocol rather than a driver dependency so the erasure-proof logic — the part whose
    correctness is the erasure guarantee — is unit-testable without a container. The real
    implementation is :class:`Neo4jStatementExecutor` below.
    """

    async def run(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Execute one statement in an implicit transaction and return its rows."""
        ...


class Neo4jStatementExecutor:
    """The real driver.

    Statements run in **implicit** (autocommit) transactions, which is not a stylistic
    choice: ``CALL { … } IN TRANSACTIONS`` commits per batch and Neo4j rejects it inside an
    explicit transaction. Running the erasure delete in a managed transaction would
    therefore fail at runtime — and the batching is the reason the delete is safe to run at
    all on a shared single instance.
    """

    __slots__ = ("_database", "_driver")

    def __init__(self, driver: AsyncDriver, database: str) -> None:
        self._driver = driver
        self._database = database

    @classmethod
    def from_environment(cls) -> Neo4jStatementExecutor:
        """Build from the environment contract in ``.env.example``.

        ``bolt://`` rather than ``neo4j://``: Community cannot cluster, so a routing URI
        has nothing to route to and fails with a confusing discovery error.
        """
        uri = os.environ.get("SHJ3_NEO4J_URI")
        if not uri:
            raise RuntimeError(
                "SHJ3_NEO4J_URI is not set. The process should have refused to start — "
                "check the boot-time config validation."
            )
        user = os.environ.get("SHJ3_NEO4J_USERNAME", "neo4j")
        secret = os.environ.get("SHJ3_NEO4J_PASSWORD")
        if not secret:
            raise RuntimeError("SHJ3_NEO4J_PASSWORD is not set.")

        # One database for every tenant (ADR-0009). Isolation is the label plus the
        # property, never the database name.
        database = os.environ.get("SHJ3_NEO4J_DATABASE", "neo4j")
        return cls(AsyncGraphDatabase.driver(uri, auth=(user, secret)), database)

    async def run(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        async with self._driver.session(database=self._database) as session:
            # The driver hints this parameter as a LiteralString, which is its own defence
            # against interpolated Cypher. That defence is supplied here by a different and
            # stronger mechanism: every statement originates in the builder, and the
            # `no-raw-cypher` gate fails the build if Cypher appears outside this package
            # (ADR-0009 rule 2). Values are always bound, never formatted in.
            result = await session.run(cypher, params or {})
            return [record.data() async for record in result]

    async def close(self) -> None:
        await self._driver.close()


@dataclass(frozen=True, slots=True)
class ErasureProof:
    """Node counts under **both** encodings after a tenant delete.

    Both must be zero. Checking only the label would miss a node whose label was removed
    but whose ``tenant_id`` survived; checking only the property would miss the reverse.
    The pair is carried out of :meth:`GraphProvisioner.destroy` so RB-12's attestation can
    quote the numbers verbatim — *"an unread proof is not a proof"*.
    """

    nodes_by_label: int
    nodes_by_property: int

    @property
    def is_complete(self) -> bool:
        return self.nodes_by_label == 0 and self.nodes_by_property == 0


class GraphErasureIncompleteError(RuntimeError):
    """Raised when a tenant delete cannot prove it removed everything.

    Deliberately distinct from a transport failure, because the operator response is
    different and the runbook is explicit about it. Residue under the **property** encoding
    with none under the label is not a delete that needs re-running — it is a node the
    write path created with one encoding and not the other, which means ADR-0009 rule 5 is
    already violated somewhere upstream. Re-running the delete would hide it.
    """

    def __init__(self, tenant: TenantSlug, proof: ErasureProof, passes: int) -> None:
        drifted = proof.nodes_by_label == 0 and proof.nodes_by_property > 0
        diagnosis = (
            "Residue exists under the tenant_id property but NOT under the tenant label. "
            "That is encoding drift, not an incomplete delete — a write path set one "
            "encoding without the other (ADR-0009 rule 5). Do not retry: find the writer."
            if drifted
            else f"Still {proof.nodes_by_label} node(s) under the tenant label after "
            f"{passes} batched pass(es). Something is writing to a tenant being erased."
        )
        super().__init__(
            f'Graph erasure for tenant "{tenant.value}" is not proven complete: '
            f"{proof.nodes_by_label} node(s) by label, {proof.nodes_by_property} by property. "
            f"{diagnosis} The tenant's schema objects have NOT been dropped, so the residue "
            "stays addressable for investigation (RB-10)."
        )
        self.tenant = tenant
        self.proof = proof
        self.passes = passes


class GraphProvisioner:
    """Create, drop and verify one tenant's graph objects."""

    __slots__ = ("_executor", "_global_schema_applied")

    def __init__(self, executor: GraphStatementExecutor) -> None:
        self._executor = executor
        self._global_schema_applied = False

    # -- bootstrap -----------------------------------------------------------

    async def apply_global_schema(self) -> int:
        """Create the database-wide constraints and index, once.

        These are *not* per-tenant. Uniqueness is composite on
        ``(tenant_id, canonicalKey)``, which covers every tenant with one constraint —
        creating it per tenant would produce N redundant constraints on the same property
        pair.

        Idempotent twice over: every statement is ``IF NOT EXISTS``, so the database is the
        real guard, and the instance flag only avoids re-issuing six statements on every
        subsequent tenant in the same process. The flag is not the correctness mechanism —
        it cannot be, since a second process knows nothing about it.
        """
        if self._global_schema_applied:
            return 0
        statements = global_schema_statements()
        for statement in statements:
            await self._run_schema(statement)
        self._global_schema_applied = True
        return len(statements)

    # -- create --------------------------------------------------------------

    async def create(self, tenant: TenantSlug) -> int:
        """Create this tenant's label-scoped indexes. Replaces ``CREATE DATABASE``.

        Returns the number of tenant-scoped statements applied. Re-running is a no-op
        because each statement is ``IF NOT EXISTS`` — which is what makes RB-09 step 2
        resumable, and it needs to be: it is eight statements, not one atomic act.
        """
        cypher = TenantCypher(tenant)
        await self.apply_global_schema()

        statements = cypher.schema_statements()
        for statement in statements:
            await self._run_schema(statement)
        return len(statements)

    # -- destroy -------------------------------------------------------------

    async def destroy(self, tenant: TenantSlug) -> ErasureProof:
        """Erase the tenant's subgraph, prove it, then drop its schema objects.

        The ordering is load-bearing and RB-10 says why: nodes are deleted **before** the
        constraints and indexes are dropped, because the by-property assertion relies on
        the property being present, and dropping schema objects first would remove the
        thing the proof is measuring.

        Raises :class:`GraphErasureIncompleteError` rather than returning a proof that
        fails, so a caller cannot accidentally treat "the delete ran" as "the data is gone".
        """
        cypher = TenantCypher(tenant)

        await self._run_query(cypher.delete_all())
        proof = await self._prove_erased(cypher)
        passes = 1

        # Re-drive only while the LABEL encoding still shows residue: that is the case a
        # further pass can fix (nodes written while the previous batch ran). Property-only
        # residue is drift and is never retried — see the error's diagnosis.
        while proof.nodes_by_label > 0 and passes < _MAX_DELETE_PASSES:
            await self._run_query(cypher.delete_all())
            proof = await self._prove_erased(cypher)
            passes += 1

        if not proof.is_complete:
            raise GraphErasureIncompleteError(tenant, proof, passes)

        for statement in cypher.drop_schema_statements():
            await self._run_schema(statement)

        return proof

    # -- verify --------------------------------------------------------------

    async def verify(self, tenant: TenantSlug) -> bool:
        """Whether this tenant's graph isolation unit exists and is correctly shaped.

        RB-11 check 5, and it asserts three things rather than one, because with a shared
        database there is no construction-level guarantee to lean on:

        1. **The label-scoped indexes exist.** After ``create`` this is the isolation unit;
           after ``destroy`` they are gone, so this alone flips the answer.
        2. **The two encodings agree.** A node labelled for this tenant but carrying a
           different ``tenant_id``, or carrying this ``tenant_id`` without the label, means
           rule 5 is already violated — and every traversal predicate becomes the only
           thing standing between two government entities.
        3. **No relationship leaves the tenant.** A cross-tenant edge is invalid by
           definition; if one exists, the isolation argument is already down to one control.

        Checks 2 and 3 are trivially satisfied on a freshly created tenant, which is the
        point: they cost one round trip each and they are the checks that would catch drift
        introduced later by a migration, a manual ``cypher-shell`` session or a restore.
        """
        cypher = TenantCypher(tenant)

        expected = cypher.schema_object_names()
        rows = await self._executor.run(_SHOW_TENANT_INDEXES, {"names": list(expected)})
        if _first_int(rows, "present") != len(expected):
            return False

        agreement = await self._run_query(cypher.assert_encoding_agreement())
        if _first_int(agreement, "labelled_but_wrong_prop") != 0:
            return False
        if _first_int(agreement, "prop_but_no_label") != 0:
            return False

        edges = await self._run_query(cypher.assert_no_cross_tenant_edges())
        return _first_int(edges, "cross_tenant_edges") == 0

    # -- internals -----------------------------------------------------------

    async def _prove_erased(self, cypher: TenantCypher) -> ErasureProof:
        rows = await self._run_query(cypher.assert_erased())
        return ErasureProof(
            nodes_by_label=_first_int(rows, "labelled"),
            nodes_by_property=_first_int(rows, "propertied"),
        )

    async def _run_query(self, query: Query) -> list[dict[str, Any]]:
        return await self._executor.run(query.cypher, query.params)

    async def _run_schema(self, statement: SchemaStatement) -> None:
        await self._executor.run(statement.cypher, {})


def _first_int(rows: list[dict[str, Any]], column: str) -> int:
    """Read one integer column from a single-row result.

    Raising on a missing column rather than defaulting to zero is deliberate: every caller
    here compares the value against zero, and a silent default would turn "the assertion
    did not run" into "the assertion passed" — on the one code path where that reading is
    an erasure claim made to a data-protection owner.
    """
    if not rows:
        raise RuntimeError(
            f'A graph assertion returned no rows while reading "{column}". The statement did '
            "not execute, so nothing has been proven."
        )
    value = rows[0].get(column)
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeError(
            f'A graph assertion returned no integer for "{column}". Refusing to interpret an '
            "absent count as zero."
        )
    return value
