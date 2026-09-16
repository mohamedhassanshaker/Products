"""Tenant identity and request-scoped tenant context.

The Python mirror of the web tier's tenancy module, and held to the same rules:

* ADR-0002 rule 1 — the tenant comes from the authenticated principal only,
  never from a header, query parameter, path segment or request body.
* ADR-0002 rule 2 — the context is bound to the request scope (``contextvars``
  here, ``AsyncLocalStorage`` in Node) and read by the data-access layer. It is
  not threaded through application signatures, because a tenant *parameter* is a
  tenant a caller can choose.
* ADR-0002 rule 4 — every isolation-unit name is derived from a validated slug
  and never interpolated from input.

This module lives in ``domain`` and therefore imports no vendor package: the
swap test in ``pyproject.toml`` forbids it, which is what keeps the tenancy rules
independent of which stores happen to be behind them.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Literal

# Two to thirty characters: a lowercase letter, then lowercase alphanumerics and
# underscores. Deliberately narrower than any single store allows, because what
# matters is the intersection of what all four accept as an identifier.
#
# No hyphens: legal in a Qdrant collection name but requiring quotes as a SQL
# Server schema and as a Neo4j label, and an identifier whose safety depends on
# remembering to quote it is not safe.
_SLUG_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,29}$")

# Names that must never become a tenant. SQL Server's own schemas and system
# databases, this project's reserved schemas, and ``neo4j`` — the single
# Community database name (ADR-0009).
_RESERVED = frozenset(
    {
        "platform",
        "tenant_template",
        "dbo",
        "sys",
        "guest",
        "information_schema",
        "db_owner",
        "db_datareader",
        "db_datawriter",
        "master",
        "model",
        "msdb",
        "tempdb",
        "neo4j",
        "system",
        "admin",
        "public",
    }
)

AssuranceLevel = Literal["L0", "L1", "L2", "L3"]
PlatformScope = Literal["provisioning", "analytics-rollup"]


class InvalidTenantSlugError(ValueError):
    """Raised when a candidate tenant slug fails validation.

    The offending value is carried on the exception but deliberately kept out of
    the message: this is raised on untrusted input and the message reaches logs.
    """

    def __init__(self, value: object, reason: str) -> None:
        super().__init__(f"Invalid tenant slug: {reason}")
        self.value = value
        self.reason = reason


class MissingTenantContextError(RuntimeError):
    """Raised when tenant-scoped work is attempted with no bound context.

    Raising rather than falling back to a default is the point. A default would
    silently read some tenant's data; the safe failure is a 500.
    """

    def __init__(self, operation: str) -> None:
        super().__init__(
            f'No tenant context bound while performing "{operation}". '
            "Tenant-scoped store access is only available inside tenant_scope(), "
            "which the authentication dependency establishes from the principal. "
            "If this is a background job, wrap it in tenant_scope() for the tenant it serves."
        )
        self.operation = operation


@dataclass(frozen=True, slots=True)
class TenantSlug:
    """A validated tenant slug.

    A dataclass rather than a bare ``str`` so a raw string cannot be passed where
    a validated slug is required — the type is the evidence that validation
    happened. Every store-name derivation takes this type, so there is no code
    path from raw input to an identifier.
    """

    value: str

    def __post_init__(self) -> None:
        if not isinstance(self.value, str):
            raise InvalidTenantSlugError(self.value, "not a string")
        if not _SLUG_PATTERN.match(self.value):
            raise InvalidTenantSlugError(
                self.value,
                "must be 2-30 characters: a lowercase letter followed by "
                "lowercase letters, digits or underscores",
            )
        if self.value in _RESERVED:
            raise InvalidTenantSlugError(self.value, "reserved name")

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value

    # -- derived store names -------------------------------------------------
    # The only functions permitted to turn a tenant into a store identifier.

    @property
    def sql_schema(self) -> str:
        """SQL Server schema holding this tenant's tables (ADR-0002)."""
        return self.value

    @property
    def graph_label(self) -> str:
        """Neo4j tenant label (ADR-0009).

        One shared Community database, so this label is half of the dual
        encoding; the other half is the ``tenant_id`` property. The two are
        always written together and asserted to agree, because either alone
        would be a single point of failure for isolation.

        ``Tenant_`` plus 30 characters is 37, which is why the registry column
        is ``VARCHAR(38)``.
        """
        return f"Tenant_{self.value}"

    @property
    def vector_collection(self) -> str:
        """Qdrant collection holding this tenant's chunk embeddings (ADR-0002)."""
        return f"{self.value}_knowledge"

    @property
    def cache_prefix(self) -> str:
        """Redis key prefix (ADR-0002).

        Returned with the trailing colon so a caller cannot produce
        ``sewasession:x`` by concatenation — a key outside the tenant namespace.
        """
        return f"{self.value}:"


@dataclass(frozen=True, slots=True)
class Principal:
    """What a feature module may know about who is asking.

    Carries nothing about *how* the principal authenticated — no token, no
    cookie, no password, no OIDC claim (ADR-0006 rule 1). That is what makes
    swapping the local password adapter for UAE PASS or Entra ID a change to
    session creation only, rather than a change to every module that gates on
    identity.
    """

    id: str
    tenant: TenantSlug
    display_name: str
    roles: frozenset[str] = field(default_factory=frozenset)
    permissions: frozenset[str] = field(default_factory=frozenset)
    assurance: AssuranceLevel = "L0"

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions

    def meets_assurance(self, required: AssuranceLevel) -> bool:
        """Compare assurance levels by rank, per B11 tab 2's step-up rules.

        Gating reads the level and never how it was established, so the mock
        verification adapter and the real UAE PASS adapter are indistinguishable
        here (ADR-0006 rule 5).
        """
        order: dict[AssuranceLevel, int] = {"L0": 0, "L1": 1, "L2": 2, "L3": 3}
        return order[self.assurance] >= order[required]


@dataclass(frozen=True, slots=True)
class TenantContext:
    """The request-scoped context every store handle reads."""

    tenant: TenantSlug
    trace_id: str
    principal: Principal | None = None
    platform_scope: PlatformScope | None = None
    """Set only for the two audited cross-tenant paths (ADR-0002 rule 5).

    Anything reading this must write an audit entry. It exists so those paths
    are visible in the code rather than achieved by bypassing the context.
    """


_context: ContextVar[TenantContext | None] = ContextVar("shj3_tenant_context", default=None)


@contextmanager
def tenant_scope(context: TenantContext) -> Iterator[TenantContext]:
    """Bind a tenant context for the duration of the block.

    Called by the authentication dependency, by the provisioning path, and by
    workers processing a job on behalf of one tenant. It must not be called from
    a feature module — that would be a module choosing its own tenant.
    """
    token: Token[TenantContext | None] = _context.set(context)
    try:
        yield context
    finally:
        # Reset rather than set(None): a nested scope must restore the outer
        # context, not clear it.
        _context.reset(token)


def require_context(operation: str) -> TenantContext:
    """Read the bound context, or raise."""
    context = _context.get()
    if context is None:
        raise MissingTenantContextError(operation)
    return context


def current_tenant(operation: str) -> TenantSlug:
    """The bound tenant, or raise. This is what the store handles call."""
    return require_context(operation).tenant


def try_get_context() -> TenantContext | None:
    """Non-raising read, for logging and diagnostics only."""
    return _context.get()


def require_principal(operation: str) -> Principal:
    """The bound principal, or raise if the request is anonymous.

    Anonymous is legitimate on the citizen surface — B11 tab 2 permits "view
    bill balance" at L0 — so callers that tolerate it should read ``principal``
    from the context directly instead of using this.
    """
    principal = require_context(operation).principal
    if principal is None:
        raise PermissionError(
            f'"{operation}" requires an authenticated principal, but the request is anonymous.'
        )
    return principal
