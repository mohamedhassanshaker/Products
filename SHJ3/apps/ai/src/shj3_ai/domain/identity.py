"""B-8's assurance ladder, mirrored from `apps/web`'s `iam/domain/assurance.ts`
and the reconciliation in `identity/domain/assurance-mapping.ts` — the exact
enum mismatch B-5 flagged (`tasks/todo.md`'s B-5 review, judgment call 3):
`FlowNodes.requiredAssurance`/`ToolBindings.requiredAssurance` persist the
closed `Anonymous`|`Verified`|`VerifiedPlusOtp`|`VerifiedPlusDocument`
vocabulary (`CK_ToolBindings_requiredAssurance` et al.), while
`Principal.assurance` (the TypeScript session-side ladder) and this module's
own `AssuranceLevel` are the `L0`-`L3` rank. Both describe the same four-level
ladder; this module is the Python-side half of resolving that.

Nothing here touches a port or SQL — pure domain, matching every other module
in `apps/ai/domain/`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

# ---------------------------------------------------------------------------
# The rank scale — `Principal.assurance` on the TypeScript side.
# ---------------------------------------------------------------------------


class AssuranceLevel(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


_RANK = {AssuranceLevel.L0: 0, AssuranceLevel.L1: 1, AssuranceLevel.L2: 2, AssuranceLevel.L3: 3}


def assurance_rank(level: AssuranceLevel) -> int:
    """Position on the ladder. Higher is stronger — mirrors `iam/domain/
    assurance.ts`'s `assuranceRank`. Exposed (not just `_RANK`) so a caller
    comparing two *already-required* levels (picking the stricter of several
    gated tool calls in one turn, for example) does not need its own copy of
    the ladder's ordering."""
    return _RANK[level]


def satisfies_assurance(held: AssuranceLevel, required: AssuranceLevel) -> bool:
    """The one comparison every gate in this module uses. `held >= required` — never `==`."""
    return _RANK[held] >= _RANK[required]


# ---------------------------------------------------------------------------
# The persisted enum — `CK_ToolBindings_requiredAssurance` et al.
# ---------------------------------------------------------------------------

#: Transcribed directly from the real CHECK constraint (`prisma/sql/001_constraints.sql`),
#: not guessed — mirrors `apps/web`'s `tools/domain/tool-catalog.ts` `REQUIRED_ASSURANCE_LEVELS`.
REQUIRED_ASSURANCE_LEVELS = ("Anonymous", "Verified", "VerifiedPlusOtp", "VerifiedPlusDocument")

#: The bijection this file exists for. See `identity/domain/assurance-mapping.ts`'s own doc
#: comment for *why* this mapping (not the collapsed L2/L2 reading `docs/data-model.md` §4.11
#: originally proposed) is the authoritative one: `docs/requirements.md`'s RISK-006 row records
#: the later, explicit product-owner decision this mapping implements, and the already-shipped,
#: already-tested `iam/domain/assurance.ts` was built to that decision.
_REQUIRED_TO_ASSURANCE: dict[str, AssuranceLevel] = {
    "Anonymous": AssuranceLevel.L0,
    "Verified": AssuranceLevel.L1,
    "VerifiedPlusOtp": AssuranceLevel.L2,
    "VerifiedPlusDocument": AssuranceLevel.L3,
}


def required_level_to_assurance(required: str) -> AssuranceLevel:
    """Raises `KeyError` on a value outside the real closed vocabulary — a
    persisted value this function cannot map is a data-integrity problem, not
    a rank to guess at."""
    return _REQUIRED_TO_ASSURANCE[required]


def satisfies_required_assurance(held: AssuranceLevel, required: str | None) -> bool:
    """The step-up gate's one real comparison — does the conversation's held rank
    satisfy the persisted `requiredAssurance` enum value a `ToolBindingRow`/
    `FlowNodeDef` carries? `required=None` means "no override configured",
    treated as `Anonymous` (no gate), matching `FlowNodes.requiredAssurance`'s
    own nullable column."""
    if required is None:
        return True
    return satisfies_assurance(held, required_level_to_assurance(required))


# ---------------------------------------------------------------------------
# Decay — assurance is only meaningful with its expiry (mirrors `iam/domain/
# assurance.ts`'s `HeldAssurance`/`effectiveAssurance`).
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CitizenAssurance:
    """What `IdentityReader.get_assurance()` hands back — the conversation's
    own `CitizenIdentities` row, read fresh every turn rather than cached on
    the conversation, since a step-up completed via `shj3-web` mid-conversation
    must be visible to the very next turn."""

    level: str  # the persisted `RequiredAssuranceLevel` enum value
    verification_expires_at: datetime | None


def effective_assurance(record: CitizenAssurance | None, now: datetime) -> AssuranceLevel:
    """Decay to `L0` once expired, or when the conversation has no linked
    identity at all (an anonymous session, or `record is None`)."""
    if record is None:
        return AssuranceLevel.L0
    if record.verification_expires_at is not None and now >= record.verification_expires_at:
        return AssuranceLevel.L0
    return required_level_to_assurance(record.level)
