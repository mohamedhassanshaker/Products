# ADR-0011 — Model Gateway v2: the three-layer Provider / Model-catalog / Route model

**Status:** Accepted · 2026-08-28
**Context refs:** FR-AGT-20, FR-AGT-21, FR-AGT-22, FR-AGT-23, FR-AGT-24, FR-AGT-25, FR-AGT-26,
FR-AGT-27, FR-KB-03, FR-SEC-02, FR-SEC-05, NFR-4a, NFR-6, spec §6.1a (Module F), §9.5,
Blueprint §11, HLD §15.6
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)
**Relationship to ADR-0006:** ADR-0006 is **not superseded**. Its core rule — the Model Gateway is
the §2 provider-agnostic registry, logical names only, no provider SDK outside
`packages/ai-registry`, OpenAI-compatible `baseURL` for on-prem — stands unchanged. This ADR
replaces only the *resolution input*: what a logical name resolves **from**.

## 1. Context

ADR-0006 gave the platform one provider-agnostic egress point and a fallback chain, but the thing
an admin actually types into a form is still a free-text model-name string (Blueprint gap G-05,
severity 1). Three consequences follow, and all three are now blocking:

1. **Nothing can pin a model.** FR-KB-03 requires a knowledge index generation to record the exact
   embedding model it was built with, forever. A free-text string is not an identity — it cannot be
   pinned, deprecated, priced, or capability-checked. This is why the Blueprint's closing box makes
   Module F a hard prerequisite for Module B, and why BL-33 gates BL-38.
2. **Capability mismatches are runtime surprises.** A fallback hop that does not support tool
   calling silently degrades an agent mid-incident.
3. **Cost, residency, and deprecation are unmodelled.** FR-AGT-24/25/26 all require a first-class
   provider and model object to hang policy off.

The existing `packages/ai-registry` already anticipated this: `ResolvedChainEntry` is documented as
"already resolved to a concrete provider/model/endpoint/credential, never a logical name or a
`model_route` row (that resolution is `packages/modules/agent-platform`'s job)". The seam exists;
this ADR fills it.

## 2. Decision

**Three layers, each an independent object, with the route as the only thing an agent version, a
knowledge collection, a team supervisor, or a workflow node may reference.**

| Layer | Object (§6.1a) | Owns | Referenced by |
|---|---|---|---|
| Provider | `model_provider` | Provider **type** (which drives the adapter), base URL, auth method + vaulted `credential_ref`, region, `retains_prompts` / `trains_on_data` flags, rate limits, health | Catalog entries |
| Model catalog | `model_catalog_entry` | One concrete servable model: model id, modality, context window, max output, capability flags, tokenizer family, price in/out/cached, status, `deprecates_at` | Route hops |
| Route | `model_route` + immutable `model_route_version` | An ordered chain of `{provider, catalog_entry, params}` hops, failover conditions, retry policy, per-hop and total timeout, cache mode, per-turn cost ceiling, `allowOutOfRegionFailover` (default `false`), budget-breach behavior | Everything else |

**2.1 Provider type drives the adapter, not the label.** The type enum is
`anthropic | openai | azure-openai | google-vertex | bedrock | openrouter | openai-compatible |
ollama | custom`. Each type maps to (a) a wire adapter and (b) a catalog-sync mechanism:

| Type | Auth | Catalog sync |
|---|---|---|
| `anthropic` | API key | Static curated list, refreshed from the provider API where available |
| `openai` | API key | `GET /v1/models` |
| `azure-openai` | API key or Entra ID | Deployment list |
| `google-vertex` | Service account or API key | Publisher model list |
| `bedrock` | IAM role or keys | Foundation-model list |
| `openrouter` | API key | `GET /api/v1/models`, then a tenant allowlist |
| `openai-compatible` | None, API key, or mTLS | `GET /v1/models` |
| `ollama` | None | `GET /api/tags` |
| `custom` | Declared per provider | Manual declaration only |

`openai-compatible` is one adapter covering vLLM, TGI, LiteLLM, and any OpenAI-shaped self-hosted
gateway — this is what keeps ADR-0006's on-prem-first-class promise from fragmenting into one
adapter per self-hosting stack. `packages/ai-registry/src/providers/` remains the **only** place a
provider SDK or wire client may be imported (existing dependency-cruiser rule
`no-provider-sdk-outside-ai-registry`, unchanged). A new provider type is one new file there plus
one enum value — no core change (NFR-12).

Self-hosted types (`openai-compatible`, `ollama`) require **no credential** but do require a
reachability probe, a concurrency limit, and a health status; unreachable is a distinct alertable
state, never a silent outage (FR-AGT-20).

**2.2 Capability validation happens at save time, not at runtime.** A route version's advertised
capability set is the **intersection across every hop in its chain** — the weakest hop wins. That
intersection is computed once, at route-version save, and stored on the immutable route version. An
agent version (or knowledge collection, or team supervisor) declares the capabilities it requires;
the save is **rejected** if the pinned route version's intersection does not contain them, naming
the offending hop and capability. There is no runtime capability negotiation and no silent
degradation. Because both the route version and the capability set are immutable, the validation
cannot go stale after the fact.

**2.3 Everything pins a version.** An agent version pins `route@version`, not `route`. Editing a
route creates a new route version and changes the behavior of exactly nothing already promoted
(the "immutable versions" invariant, spec §9.5). Route versions are YAML artifacts and therefore
get structural diff (ADR-0016) for free.

**2.4 Resolution path, unchanged in shape.** `agent-platform` resolves
`route@version → ResolvedChainEntry[]`; `packages/ai-registry` executes that chain inside
`apps/gateway`; the vault-accessor is still the only component that decrypts `credential_ref`
(ADR-0007). The Data Plane never sees a base URL, a vendor model id, or a key. The existing
env-driven single-entry fallback (`resolveModel()`, used when no route row exists) is retained as
the bootstrap/dev tier only.

**2.5 Residency and data handling are checked at both save points.** A provider whose declared
region conflicts with the tenant's residency configuration is flagged at *provider* save
(FR-AGT-20), and a route whose chain would send tenant data out of region is rejected at *route*
save (FR-AGT-25) — the earlier check exists so the error is attributable to the provider rather
than surfacing later as a confusing route error. A route surfaces the **strictest**
`retains_prompts` / `trains_on_data` flag found across its chain.

**2.6 Plan-tier governance is a mechanism here, a policy elsewhere.** The Platform Manager console
holds a `plan_tier → allowed provider types` policy table (FR-AGT-26). Architecture ships the
mechanism and a permissive default; **which types are allowed at which tier is a commercial
decision deliberately left open** (spec §9.5 item 6) and must not be hard-coded.

**2.7 The ordering dependency is enforced structurally, not by convention.**
`knowledge_index_generation.embedding_provider_id` and `.embedding_model_id` are **NOT NULL foreign
keys** into `model_provider` / `model_catalog_entry`. A knowledge collection therefore cannot be
built — the schema cannot even be migrated — before Module F exists. The Blueprint's non-negotiable
ordering (BL-33 before BL-38) is thereby a property of the data model, not a note in a plan.

## 3. Alternatives considered

**Two layers (provider + model, no route).** Rejected: the fallback chain, per-turn cost ceiling,
failover conditions, and residency policy have to live somewhere, and pushing them onto the agent
version duplicates them across every agent that shares a routing strategy — and makes
"change the fallback chain" a mass re-promotion of every agent version.

**Keep the free-text string, add a validation lookup table.** Rejected: it gives a name check and
nothing else — no price, no capability set, no deprecation date, no pinnable identity for
FR-KB-03. It would still leave gap G-05 open while looking closed.

**Route resolution inside `packages/ai-registry`.** Rejected: the registry is deliberately a leaf
package with no database access (that is what keeps the provider-SDK ban enforceable as a simple
path rule). Route resolution reads tenant-scoped rows, so it belongs in `agent-platform`, above
the registry — which is exactly where `ResolvedChainEntry`'s existing doc comment already places
it.

**A single "smart router" that picks a model per request.** Rejected for this phase: it makes a
promoted agent version's behavior non-reproducible, which contradicts the immutable-version
invariant. Cost-aware behavior is expressed instead as declared budget-breach behavior on the route
(degrade to a cheaper hop, or fail), visible **before** the breach (FR-AGT-24).

## 4. Consequences

**Positive.** A model becomes a first-class, pinnable, priced, capability-described object, which
is what unlocks embedding-model pinning (FR-KB-03), per-role standard routes (FR-AGT-23), the
tenant usage/cost view (FR-AGT-24), and residency enforcement at the model layer (FR-AGT-25).
Capability mismatches move from a production incident to a save-time validation error.

**Negative / accepted costs.**

- A migration path is required for existing agent versions carrying a free-text model name. They
  are **not** rewritten in place (immutability): provisioning creates a per-tenant route per
  distinct in-use model string, and the next version of each affected agent pins it. Until then, a
  legacy version resolves through the env/compat tier of §2.4. This dual path is temporary and must
  be removed once Phase 7 completes; leaving it is a defect, not a feature.
- Catalog sync is a new scheduled dependency on provider APIs. A failed sync is a health status on
  the provider, never a mutation of existing catalog rows — a provider that stops answering must
  not cause routes to lose their models.
- Route versions multiply (every param tweak is a version). Accepted: this is the same cost the
  platform already pays for agent versions, and structural diff (ADR-0016) makes it navigable.
- Manual catalog declaration for `custom` and some `anthropic`/vendor-direct types means the
  capability flags can be wrong because a human typed them wrong. Mitigated by a probe on save
  (a tool-calling claim is verified with one cheap live call) — a claimed capability that fails its
  probe is recorded as unverified and blocks routes that require it.

## 5. Consequences for the LLD

- Field-level schema for `model_provider`, `model_catalog_entry`, `model_route`,
  `model_route_version`, `model_usage_event` (spec §6.1a shapes; all tenant-scoped under ADR-0001,
  except `model_provider.tenant_id NULL` for platform-registered providers, which needs its own
  read policy).
- The provider-type → adapter registry table and the catalog-sync job per type (`apps/worker`).
- The capability-intersection function and where its result is persisted on the route version.
- The `requiredCapabilities` declaration on an agent version and the save-time validator.
- The resolution function `route@version → ResolvedChainEntry[]` in `agent-platform`, and the
  legacy/env compat tier's exact precedence order.
- `model_usage_event` write path and its ClickHouse projection for FR-AGT-24.

## 6. Verification

1. Save-time capability test: a route whose second hop lacks tool calling is rejected when bound to
   an agent version declaring tool calling — and the error names the hop.
2. Immutability test: editing a route does not change the resolved chain of an already-promoted
   agent version pinning the prior route version.
3. Provider-SDK boundary test: the existing `no-provider-sdk-outside-ai-registry` dependency-cruiser
   rule still passes with all nine provider types implemented.
4. Residency test: a route with an out-of-region hop is rejected at save for a region-pinned tenant,
   and `allowOutOfRegionFailover: true` is required (and audited) to accept it.
5. Ordering test: a migration attempting to create `knowledge_index_generation` without
   `model_catalog_entry` present fails — proving §2.7's structural enforcement.
6. Self-hosted test: an `openai-compatible` provider with no credential and an unreachable base URL
   reports a distinct `Unreachable` status and does not silently resolve as healthy.
