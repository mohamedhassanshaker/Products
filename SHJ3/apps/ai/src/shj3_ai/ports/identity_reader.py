"""The `IdentityReader` port — B-8's step-up gate reads a conversation's
current citizen assurance through here, fresh every turn (never cached on the
conversation row itself, since a step-up completed mid-conversation via
`shj3-web` must be visible to the very next turn's tool-call gate).

Read-only, matching `ConfigReader`'s own SELECT-only shape — `shj3_ai_ro`'s
grant is schema-wide SELECT (`prisma/sql/002_tenant_grants.sql`), so no new
grant is needed for this read.
"""

from __future__ import annotations

from typing import Protocol

from shj3_ai.domain.identity import CitizenAssurance


class IdentityReader(Protocol):
    async def get_assurance(self, citizen_identity_id: str) -> CitizenAssurance | None:
        """`None` when the id does not resolve to a live `CitizenIdentities` row
        (erased, or a data inconsistency) — the caller treats that identically
        to "no identity linked", i.e. `AssuranceLevel.L0`."""
