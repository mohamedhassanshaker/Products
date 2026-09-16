# ADR-0004 — OpenRouter for chat, OpenAI for embeddings, Cohere for rerank

- **Status:** Accepted (with an open risk)
- **Date:** 2026-09-08
- **Deciders:** Product owner (provider selection), architecture

## Context

The agent runtime needs three distinct model capabilities, and the wireframe requires all three to be configurable rather than hardcoded:

| Capability | Where the spec demands it |
|---|---|
| **Chat / reasoning** | B3 step 3 — a *primary* model (`claude-sonnet-5`) and a *fallback* model (`claude-haiku-4.5`) per agent, plus temperature. B4 — three execution modes with different token-cost profiles. |
| **Embeddings** | B6 tab 3 — embedding model is a **dropdown**: `text-embedding-3-large`, `text-embedding-3-small`, `multilingual-e5`. |
| **Reranking** | B6 tab 3 — a reranker **toggle**, on by default. |

Two constraints shape the choice:

1. **Bilingual.** B10 tab 5 requires English and Arabic, and B13's *Arabic language parity* golden set scores Arabic as a first-class quality dimension (currently failing at 71%). Retrieval quality in Arabic is a functional requirement, not a nice-to-have.
2. **Data residency.** B14 tab 4 defaults to *UAE — Sharjah data centre*, with alternatives *UAE — Dubai DC* and *Region-flexible*.

The product owner selected **OpenRouter** for model access. OpenRouter is a unified gateway over many providers with an OpenAI-compatible chat-completions API — but **it does not serve an embeddings endpoint**. That gap was raised explicitly during intake and resolved: embeddings from **OpenAI `text-embedding-3-large`**, reranking from **Cohere**.

Google ADK is the agent framework; it reaches non-Google models through LiteLLM, which speaks OpenRouter natively.

## Options considered

### Chat access

| Option | For | Against |
|---|---|---|
| **OpenRouter via LiteLLM** — *chosen* | One key, one bill, one integration for every model. Model becomes a config row, so B3's per-agent primary/fallback selection is data, not code. Trivial to A/B or swap a model without deploying. Automatic provider failover. | An extra hop and an extra party in the request path. Adds latency. Availability is now partly OpenRouter's. Text transits a third party. |
| Direct Anthropic API | Lowest latency, first access to new models, one fewer party. | One integration per provider; per-agent fallback across providers becomes bespoke code. |
| Claude on Vertex/Bedrock | Cloud IAM, VPC egress, regional residency — easiest procurement path for government. | Ties the runtime to a cloud; slightly behind on model availability. |

### Embeddings + rerank

| Option | For | Against |
|---|---|---|
| **OpenAI `text-embedding-3-large` + Cohere `rerank-v3.5`** — *chosen* | Matches the model names already written into the spec (B6 tab 3), so no spec churn. Both strong on Arabic. Zero infrastructure to operate. Immediately available. | Two more vendor accounts. Per-call cost at re-index scale. **Citizen text leaves the UAE**, conflicting with the residency default. |
| Self-hosted BGE-M3 + `bge-reranker-v2-m3` | All text stays in-region, satisfying B14 tab 4 by construction. No per-call cost. Strong multilingual including Arabic. | Requires a GPU node (or slow CPU inference) to operate and monitor. Adds an inference service to the deployment. |
| Voyage / Azure OpenAI | Top-tier quality; Azure has a UAE North region that satisfies residency contractually. | Additional procurement; Azure ties the AI service to one cloud unless kept behind a port. |

## Decision

**Three capabilities, three providers, all behind ports.**

| Capability | Provider | Model | Port |
|---|---|---|---|
| Chat / reasoning | OpenRouter (via LiteLLM, via ADK) | Per-agent config; seeded `anthropic/claude-sonnet-5` primary, `anthropic/claude-haiku-4.5` fallback | `ChatModel` |
| Embeddings | OpenAI | `text-embedding-3-large` (3072-dim) | `EmbeddingProvider` |
| Reranking | Cohere | `rerank-v3.5` | `Reranker` |

### Binding rules

1. **Ports, not SDKs.** `domain/` and `application/` never import `litellm`, `openai`, `cohere` or `google.adk`. Those appear only in `adapters/outbound/`. Grepping the inner layers for a vendor name must return nothing. This is what makes the residency swap in RISK-001 a one-adapter change.
2. **Model identity is configuration.** Primary model, fallback model and temperature are columns on the agent version record (B3 step 3), resolved at runtime. Changing a model does not require a deploy — which is the whole point of choosing a gateway.
3. **The embedding model is versioned with the index.** Each Qdrant collection records the embedding model and dimension that produced it. Changing the embedding model is a **full re-index**, never a partial one — mixing 3072-dim `text-embedding-3-large` vectors with `multilingual-e5` vectors in one collection silently destroys retrieval quality. The dropdown in B6 tab 3 must therefore warn and trigger a re-index job, not just save a preference.
4. **Fallback is real, and it is tested.** B3's fallback model is exercised when the primary errors or times out. The fallback path has its own test; an untested fallback is not a fallback.
5. **Cost and token accounting per call.** B4 requires loop and cost ceilings, and "Cost & quota management" is a named gap in the wireframe (§8). Every model call records tokens and cost against tenant, agent and conversation from day one — retrofitting per-call accounting is far harder than capturing it up front, and the ceilings in B4 cannot be enforced without it.
6. **Reranking degrades, it does not fail.** If Cohere is unavailable, retrieval returns hybrid-ranked results unreranked and records the degradation. A rerank outage must not fail a citizen conversation.
7. **No secret in code or docs.** Three API keys, environment only, validated at boot.

## Consequences

### Positive

- Per-agent primary/fallback model selection — a real requirement in B3 — is satisfied by configuration because the gateway abstracts providers.
- Swapping chat models to compare cost or quality is a config change, which makes B13's regression suites genuinely useful as a model-selection tool.
- No inference infrastructure to operate for any of the three capabilities.
- The port boundaries mean the residency risk below is remediable without touching domain code.

### Negative

- **RISK-001 (open, high):** embeddings and reranking transmit citizen text to OpenAI and Cohere, and chat transits OpenRouter. All three conflict with the *UAE — Sharjah data centre* residency default in B14 tab 4. This is a governance conflict inside the product's own configuration surface, not merely an infrastructure detail. It requires **either** a documented, signed residency exception **or** a swap to the self-hosted BGE-M3 + BGE-reranker path. It must be resolved before any production deployment carrying real citizen data. Recorded in `requirements.md`.
- Three vendor dependencies in the critical path of a citizen conversation. Mitigated by breakers and fallbacks (B5 tab 4) around each.
- OpenRouter adds a hop of latency and its own availability to every turn.
- Per-call cost is now a live operational concern; without the accounting in rule 5, spend is unbounded and invisible.

### Follow-up

- `requirements.md` carries RISK-001 with an owner and a resolution deadline.
- A spike comparing `text-embedding-3-large` against BGE-M3 on Arabic retrieval, using B13's *Arabic language parity* set as the measure. If BGE-M3 is competitive, taking the self-hosted path resolves RISK-001 and removes a per-call cost at the same time — the better outcome if the numbers allow it.
- `docs/api.md` documents the three ports and their adapter contracts.
