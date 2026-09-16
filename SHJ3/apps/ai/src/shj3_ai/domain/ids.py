"""26-character Crockford-base32 ULID — every `Char(26)` id column in this
schema's contract (`apps/web/.../ulid.ts`'s own doc comment, mirrored here
byte-for-byte: a 48-bit millisecond timestamp followed by 80 bits of
randomness, both base32-encoded). `shj3-ai` mints its own ids for the rows this
wave writes (`ConversationTurns`, `OrchestrationTraces`,
`OrchestrationTraceSteps`, `GroundingCitations`) — unlike B-4's chunk ids, which
`shj3-web` always mints (`domain/knowledge.py`'s own docstring), this wave's
writer *is* `shj3-ai`, so the id-minting responsibility moves with it.

Hand-rolled rather than a package dependency for the identical reason the
TypeScript sibling gives: no `ulid` package is a dependency of this workspace,
and the columns this mints for require `CHAR(26)` with no format CHECK, so a
minimal correct implementation is proportionate. Deliberately NOT
byte-compatible with the TS generator's exact random source (Python's `secrets`
here, Node's `randomBytes` there) — cross-language byte-identical output was
never a requirement, only "26 Crockford-base32 characters, sortable by time",
which this satisfies independently.
"""

from __future__ import annotations

import secrets
import time

_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_base32(value: int, length: int) -> str:
    out: list[str] = []
    remaining = value
    for _ in range(length):
        out.append(_CROCKFORD_BASE32[remaining % 32])
        remaining //= 32
    return "".join(reversed(out))


def new_ulid() -> str:
    """A fresh, time-sortable 26-character id. Exactly 26 characters every
    call — the width every `Char(26)` FK/PK in this schema requires
    (`lessons.md`'s own CHAR(n)-padding entry: a short hand-typed id is
    silently space-padded by SQL Server and breaks later equality lookups;
    this generator never produces a short id in the first place)."""
    timestamp_part = _encode_base32(int(time.time() * 1000), 10)
    randomness_part = "".join(_CROCKFORD_BASE32[b % 32] for b in secrets.token_bytes(16))
    return timestamp_part + randomness_part
