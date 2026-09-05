# ADR-0006 — Model Gateway as the provider-agnostic AI registry; AI data locality

**Status:** Accepted · 2026-08-15
**Context refs:** FR-AGT-07, FR-AGT-08, FR-AI-05, FR-RP-07, FR-SEC-02, FR-SEC-05, NFR-6, NFR-12; Nexus architecture guide §2 (mandatory)

## 1. Context

The product already specifies a Model Gateway: single ingress for all LLM calls, per-agent primary
model plus ordered fallback chain, routing strategy (cost / latency / fixed priority), per-tenant and
per-agent rate and budget caps, exact-match and semantic caching, centralised provider-key vaulting,
and the explicit requirement that "the Agent Runtime itself never holds provider keys".

The Nexus architecture guide §2 independently mandates a provider-agnostic registry module, logical
model names, env-driven configuration, first-class on-prem OpenAI-compatible endpoints, TypeBox-
constrained structured output re-validated on return, and an explicit data-locality statement.

These are the same component. This ADR states that they are unified rather than built twice.

## 2. Decision

**The Model Gateway (`apps/gateway/src/model-gateway`) *is* the §2 provider registry. It is the only
place in the codebase where a model-provider SDK may be imported, and the only place a vendor model
id may appear.**

### 2.1 Logical names only

Callers request a **logical model name** (`chat.primary`, `chat.fast`, `reason.deep`,
`embed.default`, `classify.guardrail`). Resolution order:

1. The Agent Definition's per-agent binding for that logical name (with its ordered fallback chain).
2. The tenant's model policy (allowlisted endpoints, region constraint, on-prem override).
3. The platform default from environment configuration.

Configuration is env-driven per guide §2: `AI_PROVIDER`, `AI_MODEL_*` (one per logical name),
`AI_BASE_URL`, `AI_API_KEY`, plus `AI_MODEL_ALLOWLIST_<REGION>`. A vendor model id never appears in
application code, in an Agent Definition's prose, or in a database default — only in configuration
and in the tenant/agent binding rows.

### 2.2 On-prem is first-class, not an afterthought

Every provider is reached through an **OpenAI-compatible chat/completions + embeddings client** by
default, so vLLM, Ollama, LM Studio, and an internal enterprise gateway are configured by setting
`AI_BASE_URL` and require no code path of their own. Providers with materially different APIs
(Anthropic, Gemini) get a thin adapter behind the same internal interface. A tenant can pin an agent
entirely to an on-prem endpoint; nothing above the gateway can tell the difference.

### 2.3 Failure behaviour (explicit, per guide §2)

Per request: connect timeout, request timeout, and a bounded retry on retryable errors (429/5xx/
connection reset) with jittered backoff — retries are safe here because a model completion is not a
backend mutation. On exhaustion, advance to the next provider in the ordered fallback chain. A
**30 s ceiling applies across the entire chain** (FR-AGT-08). On total exhaustion the gateway returns
a typed `ModelUnavailable` error and the runtime emits the FR-AI-05 backend-timeout fallback message
— it never hangs, and it never silently degrades to a different model than the chain allows. An
unreachable provider is also tripped out of rotation by a circuit breaker so the next request does
not pay its timeout again.

### 2.4 Structured output — TypeBox, validated on the return path

Any model output that feeds application logic (tool-argument extraction beyond the framework's own
tool-calling, guardrail classification, gap-suggestion mining per FR-AI-09, eval scoring, escalation
summarisation, agent-definition drafting per FR-AGT-03) is constrained by a **TypeBox** schema passed
to the framework's structured-output facility (ADK `outputSchema` / provider `responseSchema`), kept
inside the OpenAPI-3.0 subset providers accept, and **re-validated on return with `Value.Check` /
`Value.Decode`**. A schema-violating response is a typed failure that retries once with the
validation error appended, then fails to the caller's fallback. Hand-parsing JSON out of a free-text
completion is prohibited anywhere in the codebase; `nexus-qa` greps for it.

Tool input schemas discovered from MCP servers are JSON Schema already and are compiled with
TypeBox's `Value` API for validation — one validation stack, no conversion layer, no drift.

### 2.5 Keys, cost, and caching

Provider keys live in the vault (ADR-0007) and are decrypted only inside the gateway process,
satisfying FR-AGT-07's "the Agent Runtime never holds provider keys" literally rather than by
convention. Every call emits token counts and cost to the Observability Plane keyed by tenant, agent,
conversation, goal, tool, and channel (FR-AI-12, FR-RP-07). Exact-match caching is keyed on
`(tenant, logical model, resolved endpoint, normalised prompt, params)`; semantic caching is opt-in
per agent and never crosses a tenant boundary — a cache shared across tenants would be a data leak
dressed as an optimisation. Budget caps are enforced here, with the FR-RP-07 degraded-mode behaviour
(in-flight conversations complete; new starts get KB-only or straight-to-human) rather than a raw
error.

## 3. AI data locality (mandatory security statement)

**Default:** inference runs **outside** the tenant's data boundary, on a hosted third-party provider,
reached over TLS from the tenant's own regional cell. Prompt payloads are PII-masked per the tenant's
FR-SEC-04 policy before leaving the gateway. Only providers contractually offering zero-retention /
no-training terms are enabled in the platform allowlist.

**Region:** the gateway resolves endpoints from a per-region allowlist. A tenant in the UAE cell
cannot be routed to an endpoint outside its residency region unless the tenant explicitly opts in;
the opt-in is a tenant configuration change and is recorded in the audit log with actor and
timestamp. This is how FR-SEC-05's "not transiently processed outside that region beyond stateless
in-flight model calls, without explicit tenant opt-in" is operationalised.

**Tenant-controlled alternative:** a tenant may pin all of its agents to an in-region or on-prem
OpenAI-compatible endpoint, in which case no prompt content leaves its chosen region or premises.
This is a configuration change, not a different product tier or code path.

**What is never sent to a model provider:** vaulted credentials, raw tool-call payloads for tools
whose connector trust level is Untrusted (masked per FR-SEC-04 first), and any content from a tenant
other than the one owning the run.

## 4. Alternatives considered

**Let ADK call providers directly with its own model config.** Rejected: it violates guide §2, puts
provider keys in the widest-scaled fleet, and forfeits the fallback chain, caching, budget caps, and
cost attribution the product requires in FR-AGT-07/08 and FR-RP-07.

**Adopt an off-the-shelf LLM proxy (LiteLLM, Portkey, OpenRouter) as the Model Gateway.** Rejected as
the primary implementation: FR-AGT-07/08 require per-agent chains, per-tenant budget caps, tenant-
scoped semantic caching, and residency-aware endpoint allowlisting bound to our own tenancy model —
integrating those into an external proxy is more work than the thin registry we need, and it adds a
component that must itself be residency-deployed per cell. A tenant's *own* internal gateway remains
supported as a `baseURL` target, which is the interoperability that actually matters.

**Two components (a "guide §2 registry" plus the product's "Model Gateway").** Rejected as duplicated
responsibility with guaranteed drift.

## 5. Consequences

- Single point of failure for all inference: the gateway is stateless and replicated, and the
  fallback chain plus breaker mean provider outages degrade rather than fail.
- `nexus-qa` enforceable rules: no provider SDK import outside
  `apps/gateway/src/model-gateway/providers/**`; no vendor model id string outside configuration; no
  `JSON.parse` on a raw completion; every structured-output call site has a TypeBox schema on both
  the request and the return path.
- NFR-12 extensibility: a new provider is one adapter file plus configuration; a new logical model
  name is configuration only.
