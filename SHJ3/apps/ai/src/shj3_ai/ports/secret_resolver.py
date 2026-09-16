"""Resolves a `credentialSecretRef` (`env:`/`k8s:`/`vault:` — architecture.md
§10, mirrored by `apps/web`'s `modules/channels/domain/secret-reference.ts`)
into the real secret value it names. No prior adapter on the `apps/ai` side
did this at all before this wave: `adapters/outbound/tools/skill_invoker.py`'s
`_invoke_api_connector` reads `ApiConnector.credentialSecretRef` but never
resolves or sends it (a real, pre-existing gap, not one this module
introduces) — this port is the first real resolution path in this service.

Pure port: no vendor imports.
"""

from __future__ import annotations

from typing import Protocol


class SecretResolutionError(Exception):
    """A `credentialSecretRef` could not be turned into a real secret value.

    Raised for both a malformed reference and a well-formed one this
    environment's resolver does not (yet) implement — `detail` says which,
    for logs; never echoed to a citizen- or web-facing response (§2.4)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class SecretResolver(Protocol):
    async def resolve(self, reference: str) -> str:
        """`reference` is the full `<scheme>:<value>` string. Raises
        `SecretResolutionError` on any failure — never returns an empty or
        partial secret."""
        ...
