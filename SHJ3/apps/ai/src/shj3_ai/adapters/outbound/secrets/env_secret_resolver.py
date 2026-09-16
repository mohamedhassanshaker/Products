"""The real, first `SecretResolver` implementation — `env:` only.

`k8s:`/`vault:` are real, valid *reference* schemes by convention
(architecture.md §10, `secret-reference.ts`'s `SECRET_REFERENCE_PREFIXES`)
but this environment has no Kubernetes Secret store or Vault client wired
into `shj3-ai` (deployment.md documents a future k8s Secret projection, not
one built yet) — resolving them here would mean inventing a fake secret
store. Refused honestly with `SecretResolutionError` instead, naming exactly
which scheme and why, rather than silently returning an empty or made-up
value.
"""

from __future__ import annotations

import os

from shj3_ai.ports.secret_resolver import SecretResolutionError, SecretResolver

_ENV_PREFIX = "env:"
_UNIMPLEMENTED_PREFIXES = ("k8s:", "vault:")


class EnvSecretResolver(SecretResolver):
    async def resolve(self, reference: str) -> str:
        if reference.startswith(_ENV_PREFIX):
            var_name = reference[len(_ENV_PREFIX) :]
            if not var_name:
                raise SecretResolutionError('Empty "env:" secret reference — no variable name.')
            value = os.environ.get(var_name)
            if not value:
                raise SecretResolutionError(
                    f'Secret reference "env:{var_name}" names an environment variable that is '
                    "not set (or set empty) in this process."
                )
            return value

        for prefix in _UNIMPLEMENTED_PREFIXES:
            if reference.startswith(prefix):
                raise SecretResolutionError(
                    f'Secret reference uses the "{prefix}" scheme, which this environment\'s '
                    'SecretResolver does not implement yet (only "env:" is wired) — see '
                    "EnvSecretResolver's module docstring."
                )

        raise SecretResolutionError(
            'Secret reference does not start with a recognised scheme ("env:", "k8s:" or "vault:").'
        )
