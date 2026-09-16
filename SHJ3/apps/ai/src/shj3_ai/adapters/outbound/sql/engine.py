"""The one SQLAlchemy engine construction site (`no-unscoped-store-clients`).

`shj3-ai` reads SQL Server for exactly the reasons `ports/knowledge_sql.py`
documents: resolving chunk text (§5.1), reading the live `RetrievalConfig`,
and reading open `SourceConflict` penalties — all `SELECT`-only (ADR-0005
rule 5 / data-model.md §3.6's grant).

**Tenant scoping via `schema_translate_map`, not `multiSchema`.** This is the
SQLAlchemy analogue of `getTenantDb()`'s Prisma mechanism, and it does not
carry that mechanism's own pitfall: ADR-0011/`lessons.md` found that Prisma's
`multiSchema` preview feature resolves `@@schema()` to a literal name at
`prisma generate` time, not per connection at runtime — a defect specific to
that one Prisma feature, not a general "ORMs can't do dynamic schema
routing" limitation (lessons.md's own "verify the scope of a finding" entry).
SQLAlchemy's `execution_options(schema_translate_map=...)` is a genuinely
per-*execution* remap (documented core behaviour, not a preview feature), so
the generated models — declared with no fixed `schema` (`_generated_models.py`
header: "Schema bound per tenant at session creation") — resolve against
whichever tenant schema this session's map names, per call, with no shared
mutable state between concurrent requests.
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None


def _dsn() -> str:
    dsn = os.environ.get("SHJ3_SQL_DSN")
    if not dsn:
        raise RuntimeError(
            "SHJ3_SQL_DSN is not set. The process should have refused to start — check the "
            "boot-time config validation."
        )
    return dsn


def get_engine() -> AsyncEngine:
    """The process-wide engine. Lazy so a missing DSN fails at first use, not at import
    — matching `qdrant_provisioner`/`graph_provisioner`'s `from_environment()` convention
    of failing loudly and late rather than at module load.
    """
    global _engine
    if _engine is None:
        _engine = create_async_engine(_dsn(), pool_pre_ping=True)
    return _engine


def tenant_session(tenant_slug: str) -> AsyncSession:
    """One session, remapped to `tenant_slug`'s schema for its whole lifetime.

    The remap is applied via `AsyncEngine.execution_options()`, **not**
    `Session.execution_options()` — confirmed directly against a real
    `AsyncSession` (`AsyncSession` has no `execution_options` method of its
    own; `Session.execution_options()` mutates a *sync* `Session` in place and
    has no async-safe analogue), not assumed from a sync-session example.
    `Engine.execution_options()` returns a new, shallow-copied engine bound to
    those options rather than mutating the shared process-wide engine, so this
    is safe to call per request: each call gets its own schema target with no
    shared mutable state between concurrent tenants.
    """
    tenant_engine = get_engine().execution_options(schema_translate_map={None: tenant_slug})
    maker = async_sessionmaker(tenant_engine, expire_on_commit=False)
    return maker()
