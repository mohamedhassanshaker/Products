"""Unit tests for the tenant graph provisioner.

The interesting half of this file is :class:`TestDestroy`. Provisioning a graph tenant is
eight idempotent statements and is hard to get wrong; *erasing* one is a filtered delete
whose completeness has to be demonstrated (ADR-0009 rule 6), and the difference between
"the delete ran" and "the data is gone" is the whole of the right-to-be-forgotten path at
tenant scope (RB-12).

So the assertions worth reading are the ones that pin down what happens when the proof
fails: residue under the label is retried, residue under the property alone is *not* —
that is encoding drift, and re-running the delete would hide a write-path defect — and in
neither case are the tenant's schema objects dropped, because dropping them would remove
the thing the next proof would measure.

No containers. The executor is a fake, which is exactly why this logic was put behind a
protocol.
"""

from __future__ import annotations

from typing import Any

import pytest

from shj3_ai.adapters.outbound.graph.cypher_builder import TenantCypher, global_schema_statements
from shj3_ai.adapters.outbound.graph.graph_provisioner import (
    ErasureProof,
    GraphErasureIncompleteError,
    GraphProvisioner,
)
from shj3_ai.domain.tenancy import TenantSlug

SEWA = TenantSlug("sewa")


class ScriptedExecutor:
    """Records every statement and answers the assertions from configurable state."""

    def __init__(self) -> None:
        self.statements: list[str] = []
        #: Successive answers for the erasure proof, as (by_label, by_property).
        self.erasure: list[tuple[int, int]] = []
        self.indexes_present = 3
        self.agreement: tuple[int, int] = (0, 0)
        self.cross_tenant_edges = 0

    async def run(self, cypher: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self.statements.append(cypher)

        if "labelled_but_wrong_prop" in cypher:
            labelled_but_wrong, prop_but_no_label = self.agreement
            return [
                {
                    "labelled_but_wrong_prop": labelled_but_wrong,
                    "prop_but_no_label": prop_but_no_label,
                }
            ]
        if "cross_tenant_edges" in cypher:
            return [{"cross_tenant_edges": self.cross_tenant_edges}]
        if "propertied" in cypher:
            by_label, by_property = self.erasure.pop(0) if self.erasure else (0, 0)
            return [{"labelled": by_label, "propertied": by_property}]
        if cypher.startswith("SHOW INDEXES"):
            return [{"present": self.indexes_present}]
        return []

    def count(self, fragment: str) -> int:
        return sum(1 for statement in self.statements if fragment in statement)


@pytest.fixture
def executor() -> ScriptedExecutor:
    return ScriptedExecutor()


@pytest.fixture
def provisioner(executor: ScriptedExecutor) -> GraphProvisioner:
    return GraphProvisioner(executor)


class TestCreate:
    async def test_applies_global_schema_and_tenant_indexes(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        created = await provisioner.create(SEWA)

        assert created == len(TenantCypher(SEWA).schema_statements())
        for statement in global_schema_statements():
            assert statement.cypher in executor.statements
        for statement in TenantCypher(SEWA).schema_statements():
            assert statement.cypher in executor.statements

    async def test_global_schema_is_applied_once_per_process(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        # N tenants must not mean N copies of one composite constraint — that is the whole
        # reason uniqueness is global rather than per tenant.
        await provisioner.create(SEWA)
        await provisioner.create(TenantSlug("customs"))

        first_global = global_schema_statements()[0].cypher
        assert executor.count(first_global) == 1

    async def test_is_idempotent(self, provisioner: GraphProvisioner) -> None:
        # RB-09 step 2 is eight statements rather than one atomic act, so an operator
        # re-running after a failure at statement five must not collide.
        assert await provisioner.create(SEWA) == await provisioner.create(SEWA)

    async def test_every_statement_is_guarded(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        await provisioner.create(SEWA)
        assert all("IF NOT EXISTS" in statement for statement in executor.statements)


class TestDestroy:
    async def test_deletes_proves_then_drops_schema_objects(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        proof = await provisioner.destroy(SEWA)

        assert proof == ErasureProof(nodes_by_label=0, nodes_by_property=0)

        # Order is load-bearing: the by-property assertion relies on the property still
        # being present, so nodes go before schema objects (RB-10).
        delete_index = next(
            i for i, s in enumerate(executor.statements) if "IN TRANSACTIONS OF" in s
        )
        drop_index = next(
            i for i, s in enumerate(executor.statements) if s.startswith("DROP INDEX")
        )
        assert delete_index < drop_index

        for statement in TenantCypher(SEWA).drop_schema_statements():
            assert statement.cypher in executor.statements

    async def test_absent_tenant_is_a_no_op(self, provisioner: GraphProvisioner) -> None:
        # Rollback runs after a failure and cannot know what was created, so destroy has to
        # tolerate there being nothing there.
        assert (await provisioner.destroy(SEWA)).is_complete

    async def test_redrives_the_delete_while_label_residue_remains(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.erasure = [(12, 12), (4, 4), (0, 0)]

        proof = await provisioner.destroy(SEWA)

        assert proof.is_complete
        assert executor.count("IN TRANSACTIONS OF") == 3

    async def test_refuses_when_label_residue_survives_every_pass(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.erasure = [(5, 5)] * 20

        with pytest.raises(GraphErasureIncompleteError) as raised:
            await provisioner.destroy(SEWA)

        assert "writing to a tenant being erased" in str(raised.value)
        assert not any(s.startswith("DROP INDEX") for s in executor.statements)

    async def test_property_only_residue_is_drift_and_is_never_retried(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        # The distinction this whole design exists for. Zero by label, non-zero by
        # property means a node was written with one encoding and not the other, so the
        # delete has nothing left to match and a retry would only hide the defect.
        executor.erasure = [(0, 3)]

        with pytest.raises(GraphErasureIncompleteError) as raised:
            await provisioner.destroy(SEWA)

        assert "encoding drift" in str(raised.value)
        assert "Do not retry" in str(raised.value)
        assert executor.count("IN TRANSACTIONS OF") == 1
        assert not any(s.startswith("DROP INDEX") for s in executor.statements)

    async def test_refuses_to_interpret_a_missing_count_as_zero(
        self, provisioner: GraphProvisioner
    ) -> None:
        class SilentExecutor:
            async def run(
                self, cypher: str, params: dict[str, Any] | None = None
            ) -> list[dict[str, Any]]:
                return []

        with pytest.raises(RuntimeError, match="nothing has been proven"):
            await GraphProvisioner(SilentExecutor()).destroy(SEWA)


class TestVerify:
    async def test_true_when_indexes_exist_and_encodings_agree(
        self, provisioner: GraphProvisioner
    ) -> None:
        assert await provisioner.verify(SEWA) is True

    async def test_asks_about_the_names_the_builder_created(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        await provisioner.verify(SEWA)
        assert executor.count("SHOW INDEXES") == 1
        assert len(TenantCypher(SEWA).schema_object_names()) == executor.indexes_present

    async def test_false_when_an_index_is_missing(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.indexes_present = 2
        assert await provisioner.verify(SEWA) is False

    async def test_false_after_destroy_dropped_the_indexes(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        await provisioner.destroy(SEWA)
        executor.indexes_present = 0
        assert await provisioner.verify(SEWA) is False

    async def test_false_when_a_node_carries_the_label_but_another_tenants_id(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.agreement = (1, 0)
        assert await provisioner.verify(SEWA) is False

    async def test_false_when_a_node_carries_the_id_but_not_the_label(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.agreement = (0, 1)
        assert await provisioner.verify(SEWA) is False

    async def test_false_when_a_relationship_leaves_the_tenant(
        self, provisioner: GraphProvisioner, executor: ScriptedExecutor
    ) -> None:
        executor.cross_tenant_edges = 1
        assert await provisioner.verify(SEWA) is False


class TestSchemaObjectNames:
    def test_match_the_statements_that_create_them(self) -> None:
        # Verification introspects by name, so a divergence between the names created and
        # the names asked about would make a correctly provisioned tenant fail its own
        # check — silently, and only in a deployed environment.
        cypher = TenantCypher(SEWA)
        for name in cypher.schema_object_names():
            assert any(f"CREATE INDEX {name} " in s.cypher for s in cypher.schema_statements())

    def test_match_the_statements_that_drop_them(self) -> None:
        cypher = TenantCypher(SEWA)
        for name in cypher.schema_object_names():
            assert any(f"DROP INDEX {name} " in s.cypher for s in cypher.drop_schema_statements())

    def test_are_derived_per_tenant(self) -> None:
        assert (
            TenantCypher(SEWA).schema_object_names()
            != TenantCypher(TenantSlug("customs")).schema_object_names()
        )
