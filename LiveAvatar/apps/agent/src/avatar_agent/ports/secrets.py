"""`SecretStorePort` — resolves a `credential_ref` to its secret value.

The control plane never returns a raw secret (LLD §5.9); the agent resolves
`credential_ref` strings itself from a mounted secret directory
(`secrets/directory_store.py`), keeping exactly one process able to read
production credentials.
"""

from __future__ import annotations

from typing import Protocol


class SecretNotFoundError(Exception):
    """Raised when a `credential_ref` has no corresponding secret on disk."""


class SecretStorePort(Protocol):
    """Resolves a `credential_ref` to its secret value."""

    def resolve(self, credential_ref: str) -> str:
        """@param credential_ref: opaque reference stored on `ProviderCredential`.
        @returns: the secret value (e.g. an API key).
        @raises SecretNotFoundError: if no secret exists for this ref.
        """
        ...
