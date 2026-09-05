"""On-prem / gateway LLM adapter (`llm.openai-compatible`, LLD §7.3/§7.4).

Wraps any OpenAI-compatible HTTP endpoint (Ollama, vLLM, LM Studio, an
internal gateway) via `base_url` — this is what keeps "point at a local
model" a first-class remedy even though spec §7.2 defers an on-prem *catalog*
entry (there is no `llm.openai-compatible` literal in the canonical YAML
`provider` enum; this factory is reached only via `AI_BASE_URL`/`AI_PROVIDER`
env defaults, never a tenant's published config, in v1).

Named with a leading underscore (not part of the canonical catalog-facing
adapter set) to make that distinction obvious at a glance.
"""

from __future__ import annotations

from avatar_agent.adapters.llm.openai import OpenAiLlmAdapter
from avatar_agent.ports.runtime import ProviderRuntime


class OpenAiCompatibleLlmAdapter(OpenAiLlmAdapter):
    """Identical wire protocol to `OpenAiLlmAdapter`; the only distinction is
    that `endpoint_url` is mandatory (an on-prem/gateway base URL) rather
    than the vendor's default.
    """

    key = "openai-compatible"

    def __init__(self, runtime: ProviderRuntime) -> None:
        if not runtime.endpoint_url:
            raise ValueError("llm.openai-compatible requires an endpoint_url (AI_BASE_URL)")
        super().__init__(runtime)
