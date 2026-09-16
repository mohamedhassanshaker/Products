# SHJ3 — API Contracts

> Status: **Accepted** · Last updated: 2026-09-08
> Binding. Derived from [`SHJ3-wireframes-guide.md`](./SHJ3-wireframes-guide.md) (functional baseline), [`architecture.md`](./architecture.md) (structure), and ADRs [0001](./adr/0001-modular-monolith-across-two-runtimes.md), [0004](./adr/0004-llm-gateway-and-retrieval-models.md), [0006](./adr/0006-identity-behind-a-port.md).
> Changing a locked decision here means writing an ADR, not editing this file in place.

---

## 0. The three surfaces

There are exactly three API surfaces. They differ in consumer, trust model, versioning policy and blast radius, and they are never mixed on one path prefix.

| # | Surface | Served by | Consumed by | Auth | Path prefix | Versioned |
|---|---|---|---|---|---|---|
| 1 | **Public / citizen** | `shj3-web` | Assistant widget embedded on `sharjah.ae`; WhatsApp BSP webhook; payment gateway callbacks | Anonymous or citizen-session cookie; webhooks by signature | `/api/public/v1/…`, `/api/webhooks/…` | **Yes** |
| 2 | **Backoffice** | `shj3-web` | The Next.js backoffice UI only | Staff session (opaque, Redis) + RBAC | `/api/backoffice/…` | **No** |
| 3 | **Internal** | `shj3-ai` | `shj3-web` only | mTLS in-cluster | `/v1/…` | **Yes** |

Surface 3 is unreachable from outside the namespace: a Kubernetes `NetworkPolicy` admits ingress to `shj3-ai:8000` from pods labelled `app=shj3-web` and from nothing else. There is no Ingress, no Service of type LoadBalancer, and no public DNS name for `shj3-ai`. A leaked internal URL is therefore not an exploitable finding.

`shj3-web` holds **no Neo4j driver and no Qdrant client in its dependency tree** ([ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md) constraint 2). Every backoffice screen that shows graph or vector data — B6 tab 2's graph explorer, B6 tab 3's retrieval playground — is a thin proxy over surface 3. Those proxy rows are marked *(proxy)* throughout §6.

---

## 1. Purpose & conventions

### 1.1 REST style and resource naming

- Resources are **plural nouns**, lowercase, hyphen-separated: `/agents`, `/golden-sets`, `/routing-rules`, `/mcp-servers`.
- Collections and members: `GET /agents`, `GET /agents/{agentId}`. Sub-collections nest one level at most: `/agents/{agentId}/versions`. Deeper relationships become top-level resources with a filter (`/promotions?agentId=…`), because a four-segment path is a modelling failure, not a route.
- **State transitions that are not CRUD are sub-resource `POST`s**, not `PATCH` with a magic field. `POST /agents/{id}/publish`, `POST /promotions/{id}/approve`, `POST /breakers/{id}/reset`. Rationale: each carries its own permission, its own audit entry and its own pre-conditions; a single `PATCH /agents/{id}` with `{"status":"published"}` would hide four different authorization decisions behind one route.
- `PATCH` is a partial update with **merge-patch semantics** (`application/merge-patch+json` is accepted, `application/json` is treated identically). `null` clears a nullable field. Absent means unchanged. `PUT` is a full replacement and is used only where the whole document is genuinely the unit of edit — retrieval config, the widget studio settings, a flow graph.
- No RPC verbs in collection paths (`/getAgents` is invalid), no `:action` colon syntax, no `X-HTTP-Method-Override`.
- Field names are `camelCase` on all three surfaces. The Python service serialises with `alias_generator=to_camel`; the wire format is one convention regardless of which runtime produced it.
- Enum values on the wire are `snake_case` string constants, never integers. `"status": "awaiting_approval"`, never `"status": 3`. Integer enums are unreadable in logs and unversionable.

### 1.2 Versioning

| Surface | Policy | Why |
|---|---|---|
| **Public** `/api/public/v1` | URL-versioned. `v1` is supported for **12 months** after `v2` ships. Breaking changes require a new major segment. | The widget script is embedded in pages `shj3.ae` does not deploy (`sharjah.ae`, `services.shj.ae` — B10 tab 2 allowed domains) and is cached in citizen browsers. A stale widget must keep working. Same for the WhatsApp BSP and the payment gateway, whose callback URLs are configured in third-party consoles and cannot be changed in lockstep with a deploy. |
| **Backoffice** `/api/backoffice` | **Unversioned.** Deployed in lockstep with its only consumer. | The backoffice UI and its route handlers ship in the same container image, from the same commit, behind the same rollout. There is never a version skew window longer than a rolling restart, and no third party is entitled to call these routes. Adding a version segment would imply a compatibility promise that nothing needs and that would rot. Breaking a backoffice contract is a same-PR concern caught by TypeScript, not a deprecation cycle. |
| **Internal** `/v1` | URL-versioned, contract-tested. | `shj3-web` and `shj3-ai` are **two deployables with independent rollouts** ([ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md)). During a rollout, a v-old web pod talks to a v-new ai pod. Versioning plus generated types is what makes that hop safe. A type error across this boundary is a runtime failure, not a compile failure — so the boundary is versioned and covered by contract tests. |

**The shared OpenAPI document.** `shj3-ai` is the source of truth for surface 3. FastAPI emits `/v1/openapi.json`; `pnpm gen:internal-client` writes `packages/internal-client/` (typed fetch client + Zod schemas) from it. The generated client is committed. Pre-commit regenerates and requires an empty diff — the same discipline [ADR-0005](./adr/0005-prisma-owns-schema-sqlalchemy-reads.md) applies to the SQL schema. `shj3-web` may not hand-write a request type for surface 3.

Deprecation, when it happens, is advertised on the response, not in an email:

```http
Deprecation: Sun, 01 Mar 2026 00:00:00 GMT
Sunset: Wed, 01 Jul 2026 00:00:00 GMT
Link: <https://docs.shj3.gov.ae/api/migrations/v1-to-v2>; rel="deprecation"
```

### 1.3 Pagination — cursor, everywhere

Every collection is cursor-paginated. There is no `offset`/`page` parameter on any surface.

```http
GET /api/backoffice/governance/audit-log?limit=50&cursor=eyJ0IjoiMjAyNi0wOS0wOFQwOToxMjozM1oiLCJpIjoiYXVkX2FiYzEyMyJ9
```

```json
{
  "data": [ { "id": "aud_abc123", "…": "…" } ],
  "page": {
    "nextCursor": "eyJ0IjoiMjAyNi0wOS0wOFQwODo1MTowMloiLCJpIjoiYXVkX2FhYTAwMSJ9",
    "prevCursor": null,
    "hasMore": true,
    "limit": 50
  }
}
```

- The cursor is an **opaque** base64url keyset token over `(sortKey, id)`. It is not a document to be parsed, constructed or incremented by a client; a malformed or foreign cursor is `400 pagination.cursor_invalid`, never a silent fallback to page 1. Tampering with it cannot widen a query — the tenant still comes from the principal (§12 invariant 1), and the cursor's decoded sort key is clamped to the filter set that produced it.
- `limit` default 25, maximum 100. `limit=0` or `limit>100` is `422 validation.failed`.
- Cursors are valid for 15 minutes and are bound to the exact filter/sort combination that produced them. Changing a filter while holding a cursor is `400 pagination.cursor_filter_mismatch` rather than a quietly wrong result set.

**Why cursor and not offset — specifically for the audit log and the conversation explorer.** Both are append-heavy, descending-by-time lists over tables that gain rows continuously while a human reads them.

1. **Offset drifts under insertion.** The audit log (B14 tab 2) gains an entry on every publish, policy change, permission grant and export. With `OFFSET 50`, a row inserted at the head between page 1 and page 2 pushes one row from page 1 down into page 2 — the reader sees it **twice** and, symmetrically, an entry can be skipped entirely. For an *immutable change record* that reviewers use to reconstruct who did what, a pagination scheme that can silently omit an entry is not acceptable. Keyset pagination on `(occurredAt DESC, id DESC)` is stable: the boundary is a value, not a count, so head insertions cannot shift it.
2. **Offset does not scale.** `OFFSET 40000` makes SQL Server read and discard 40,000 rows. The conversation explorer (B1 tab 2) sits over 36,410 conversations in the last 30 days at seeded volume and grows monotonically; deep pages get slower every day. Keyset pagination is a single index seek at any depth: `WHERE (occurredAt, id) < (@t, @i) ORDER BY occurredAt DESC, id DESC`, backed by exactly that composite index.
3. **The audit log has no total anyway.** `COUNT(*)` over an append-only table is both expensive and meaningless as a UI affordance — nobody navigates to page 812 of an audit log. `hasMore` is the only fact the UI needs.

Consequence, stated plainly: **`totalCount` is not returned on any collection.** The UI renders "Load more" / infinite scroll, not numbered pages. Where a count genuinely matters as a *metric* rather than a pagination aid — conversations in a date range (B1 tab 1), cases in a golden set (B13 tab 1) — it comes from a purpose-built aggregate endpoint or a maintained counter column, not from paging.

### 1.4 Filtering and sorting

| Convention | Form | Example |
|---|---|---|
| Equality | `?field=value` | `?status=escalated` |
| Set membership | repeated param | `?channel=web&channel=whatsapp` |
| Range | `?field.gte=` / `?field.lte=` / `?field.gt=` / `?field.lt=` | `?occurredAt.gte=2026-09-01T00:00:00Z` |
| Named window | `?range=today\|last_7d\|last_30d` | B1 tab 1's date-range toggle |
| Free text | `?q=` | B6 tab 2 entity search, B14 tab 2 audit search |
| Sort | `?sort=field` / `?sort=-field` for descending; comma-separated for tie-breaks | `?sort=-occurredAt,-id` |

- Only **allow-listed** fields are filterable and sortable per resource. An unknown field is `422 validation.failed` with `field: "sort"` — never ignored, because a silently dropped filter shows the user more data than they asked for, and on a multi-tenant government system that is a security-relevant behaviour, not a UX quirk.
- `?q=` is a full-text search on a declared subset of columns. It is never interpolated into SQL, Cypher or a Qdrant filter expression; it is a bound parameter or a driver-level query object at every layer.
- The default sort is documented per resource and is always deterministic — every sort has `id` appended as the final tie-break, otherwise cursor pagination over a non-unique sort key can loop or skip.

### 1.5 Idempotency keys

`Idempotency-Key` is a **required** request header on every endpoint that moves money, sends an outbound message to a citizen, or submits work to a third party. Absent → `400 idempotency.key_required`. It is optional-but-honoured on all other unsafe methods.

Endpoints where the key is mandatory:

| Endpoint | Why |
|---|---|
| `POST /api/backoffice/payments/transactions/{ref}/refund/approve` | Moves money (B11 tab 4) |
| `POST /api/backoffice/payments/transactions/{ref}/refund/decline` | Terminal state transition on a financial record |
| `POST /api/public/v1/conversations/{id}/payments/intents` | Creates a payment intent at the gateway |
| `POST /api/backoffice/channels/campaigns/{id}/send-now` | Outbound message fan-out (B10 tab 4) |
| `POST /api/backoffice/channels/campaigns/{id}/enable` | Arms a trigger that sends outbound messages |
| `POST /api/backoffice/channels/whatsapp/templates` | Submits to the BSP; duplicate submissions create duplicate Meta review items |
| `POST /api/backoffice/handover/tickets/{id}/messages` | Outbound message to a citizen |
| `POST /api/backoffice/agents/{id}/publish` | Not money, but a duplicate publish would mint a duplicate version and a duplicate audit entry |
| `POST /api/backoffice/governance/promotions/{id}/approve` \| `/reject` | Writes an irreversible audit entry |
| `POST /v1/knowledge/reindex` | Expensive long-running job; a double-submit should return the running job, not start a second |
| `POST /evaluation/golden-sets/{id}/runs` (`apps/web`) | The regression-run orchestration itself lives here, not on `shj3-ai` (§5.7's own 2026-09-10 correction) — a double-submit should return the in-flight `RegressionRun`, not start a second (`UQ_RegressionRuns_active`, real DB-level enforcement either way) |

Semantics:

1. Key is a client-generated string, 16–128 chars, `[A-Za-z0-9_-]`. A UUIDv4 is the expected form.
2. Scope is `(tenantId, principalId, method, path, idempotencyKey)` — a key cannot be replayed across tenants, users or routes.
3. On first receipt the key is claimed with `SETNX` in Redis. Concurrent second request while the first is in flight → `409 idempotency.request_in_progress` with `Retry-After: 1`.
4. On completion the response status, headers and body are stored for **24 hours**. A replay returns the stored response byte-for-byte with `Idempotency-Replayed: true`.
5. Same key, **different request body** (compared by canonical-JSON SHA-256) → `422 idempotency.key_reused`. This is the important case: it catches a client reusing a key across two genuinely different refunds, which silently succeeding would turn into a lost refund.
6. Keys are not stored for `4xx` validation failures — a rejected malformed request may be corrected and retried with the same key.

### 1.6 Request ids and trace propagation

One trace id spans **web → ai → tool call**, which is what makes B14 tab 3's observability table real rather than decorative ([`architecture.md`](./architecture.md) §10).

| Header | Direction | Meaning |
|---|---|---|
| `traceparent` / `tracestate` | in + out, all surfaces | W3C Trace Context. If absent on an inbound public request, `shj3-web` starts a new trace. It is **always** propagated to `shj3-ai`, and `shj3-ai` propagates it onto MCP calls and API connector calls. |
| `X-Request-Id` | in + out | Per-hop id. Echoed on the response. If the client supplies one it is accepted (validated as ≤128 chars, `[A-Za-z0-9_-]`) and used as the log correlation id; otherwise generated. |
| `X-SHJ3-Conversation-Id` | web → ai | Set as an OTel span attribute so a conversation can be reconstructed across both runtimes. |
| `Server-Timing` | out | `db;dur=12, ai;dur=1840` on backoffice reads. Cheap, and it kills the "is it the UI or the backend" argument. |

Every response — success or error — carries `X-Request-Id` and a `traceId`. On errors, `traceId` is also inside the problem body (§2), because that is the string a citizen or an admin reads out to support. The trace id is the **only** internal identifier that appears in a client-visible error.

An inbound `traceparent` from the public internet is honoured for correlation but is never trusted for sampling decisions or authorization; a caller cannot force a trace to be recorded (a sampling-flag DoS) — the sampler decision is recomputed at the edge.

### 1.7 Content types

| Type | Where |
|---|---|
| `application/json; charset=utf-8` | Default request and response |
| `application/merge-patch+json` | Accepted on `PATCH` (equivalent to `application/json`) |
| `text/event-stream` | Turn streaming, both public and internal (§4, §5); handover queue events |
| `application/problem+json` | **All** error responses (§2) |
| `multipart/form-data` | Knowledge source document upload; theming logo/favicon upload; user-guide screenshot upload |
| `audio/mpeg` | TTS response (`POST …/speech`) |
| `audio/webm`, `audio/mp4`, `audio/wav` | Speech-to-text upload |
| `application/json` (skin schema) | Skin export/import (§7) |

- A request body with an unsupported `Content-Type` → `415 request.unsupported_media_type`.
- `Accept` is honoured only where more than one representation exists (`audio/mpeg` vs `application/json` for TTS). Elsewhere an unsatisfiable `Accept` returns JSON rather than `406`; refusing to serve a monitoring probe over a header nicety is not a useful behaviour.
- Request bodies are capped: 1 MiB JSON on public, 4 MiB JSON on backoffice, 64 MiB multipart for source documents. Over → `413 request.payload_too_large`.
- All text is UTF-8. Arabic content is not escaped in JSON output (`ensure_ascii=false`); responses declare `charset=utf-8`.

### 1.8 Dates, times, money, ids

- **All timestamps are RFC 3339 with an explicit `Z` offset, UTC, millisecond precision**: `2026-09-08T09:12:33.481Z`. No local times on the wire, ever. No epoch integers.
- Wall-clock rules that are inherently local carry an IANA zone alongside them, because "21:00" is meaningless without one. Quiet hours (B10 tab 4) and human-agent working hours (B10 tab 1) serialise as `{"start":"21:00","end":"07:00","timeZone":"Asia/Dubai"}`. The zone is `Asia/Dubai` for every tenant; it is nonetheless explicit in the payload rather than implied by the server.
- Durations are ISO 8601 (`PT2M` cooldown, `P90D` retention) or an integer with the unit in the field name (`sessionWindowHours: 24`). Never a bare number whose unit lives in a comment.
- Dates without a time are `YYYY-MM-DD`.
- **Money is an integer minor unit plus a currency code.** `{"amount": 41200, "currency": "AED"}` is AED 412.00. No floats anywhere near a transaction; no `"AED 412.00"` strings to be parsed by a client.
- Percentages that are configuration thresholds are integers 0–100 (`minAccuracy: 85`). Model-produced scores are floats 0–1 (`confidence: 0.94`, `score: 0.91`). The two are never mixed on one field.
- Ids are opaque prefixed strings: `agt_01JB…`, `conv_01JB…`, `txn_01JB…`, `aud_01JB…` (ULID body — sortable, and a prefix makes a misrouted id obvious in a log). Clients never construct or parse them. The one exception is the human-facing transaction reference `TXN-88213` from B11 tab 4, which is a distinct, indexed, user-quotable field (`reference`) alongside the internal `id`.

### 1.9 Concurrency control

Configuration resources that two admins can plausibly edit at once return an `ETag` and honour `If-Match`:

```http
PATCH /api/backoffice/governance/policies/grounding_threshold
If-Match: "W/\"7d3f21\""
```

A mismatch is `409 concurrency.stale_write` carrying the current `ETag` and the current representation, so the UI can show a real diff instead of last-write-wins. Mandatory (`If-Match` required, absent → `428 concurrency.precondition_required`) on: global policies (B12 tab 1), the permission matrix (B9 tab 3), retrieval config (B6 tab 3), the publish gate (B13 tab 3), routing-rule order (B8), and the token set (§7). These are exactly the resources where a lost update silently weakens a control.

---

## 2. Error model

**RFC 9457 (`application/problem+json`) for every error on all three surfaces.** No deviation. The rationale is not standards-compliance for its own sake: there are three surfaces, two languages, and a proxy layer where `shj3-web` forwards `shj3-ai` failures. A single wire shape means the web tier can pass a problem document through, or wrap it, without a translation table, and one client-side error handler covers everything.

### 2.1 The shape

```json
{
  "type": "https://api.shj3.gov.ae/problems/governance.policy_locked",
  "title": "Policy is locked",
  "status": 409,
  "detail": "This policy is a platform floor and cannot be changed by any role.",
  "instance": "/api/backoffice/governance/policies/mask_pii",
  "code": "governance.policy_locked",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "requestId": "req_01JBQ7X2K9",
  "timestamp": "2026-09-08T09:12:33.481Z"
}
```

Beyond the five RFC 9457 members, four extensions are always present:

| Member | Rule |
|---|---|
| `code` | **Stable, machine-readable, versioned as part of the contract.** `<domain>.<reason>`, lowercase `snake_case` after the dot. Clients branch on `code`, never on `title` or `detail`. A code is never repurposed; retiring one means adding a new one. |
| `traceId` | W3C trace id. The only internal identifier ever exposed. |
| `requestId` | Per-hop id, matches the `X-Request-Id` response header. |
| `timestamp` | RFC 3339 UTC. |

`type` is a resolvable documentation URL built mechanically from `code`. `title` is a short, stable, human-readable summary — safe to display. `detail` is instance-specific and safe to display. `instance` is the request path.

Field-level validation errors add an `errors` array:

```json
{
  "type": "https://api.shj3.gov.ae/problems/validation.failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "3 fields failed validation.",
  "code": "validation.failed",
  "traceId": "4bf92f…",
  "requestId": "req_01JBQ7X2K9",
  "timestamp": "2026-09-08T09:12:33.481Z",
  "errors": [
    { "pointer": "/temperature",        "code": "number.max",       "detail": "Must be at most 2.",                    "meta": { "max": 2 } },
    { "pointer": "/channels/1",         "code": "enum.invalid",     "detail": "Must be one of: web, whatsapp, mobile, kiosk." },
    { "pointer": "/fallbackModel",      "code": "field.required",   "detail": "Required when a primary model is set." }
  ]
}
```

- `pointer` is an RFC 6901 JSON Pointer into the **request body**. Query and header failures use `parameter` instead of `pointer` (`{"parameter":"sort","code":"enum.invalid"}`).
- `errors[].code` is drawn from a fixed vocabulary (`field.required`, `field.unknown`, `type.invalid`, `enum.invalid`, `string.min`, `string.max`, `string.pattern`, `number.min`, `number.max`, `array.min`, `array.max`, `format.invalid`, `reference.not_found`, `value.conflict`, `value.immutable`) so a UI can localise without string-matching English.
- The same Zod schema produces the request validation in the route handler and the form validation in the client ([`architecture.md`](./architecture.md) §9), so the two can never disagree about what is required.
- **Validation is exhaustive, not fail-fast.** All field errors for a request are returned in one response. Returning one error at a time makes a 10-step wizard (B3) unusable.
- **Unknown fields are rejected**, not stripped: `field.unknown` → `422`. A silently ignored field is how a client believes it disabled a guardrail that is still on.

### 2.2 What an error body may never contain

Non-negotiable. Enforced by a single error-serialisation function per runtime — no route handler constructs a problem document by hand, and no `except`/`catch` block interpolates an exception message into `detail`.

| Forbidden | Because |
|---|---|
| Stack traces, file paths, line numbers, module names | Discloses internal structure and versions |
| SQL text, Cypher text, constraint names, table or column names | Discloses the schema; `UNIQUE KEY sewa.Agents.name` also leaks the tenant schema name |
| Vendor error text or vendor status codes from OpenRouter, OpenAI, Cohere, Neo4j, Qdrant, the BSP or a payment gateway | A caller must not be able to fingerprint the model gateway or read a provider's message. See §2.4. |
| Upstream URLs, internal hostnames, IPs, ports, Kubernetes service names | Discloses topology |
| Prompt text, system instructions, retrieved passages | Prompt disclosure is a security boundary |
| Any tenant identifier other than the caller's own | Cross-tenant inference |
| Unmasked PII (Emirates ID, account number, card number, mobile) — including inside `errors[].detail` and inside echoed input | Invariant 4 (§12). A validation error on an account number reports the field, never the value. |
| Whether an account, user, email or conversation exists, on unauthenticated routes | Enumeration |

Two behaviours follow from the last row. `POST /api/backoffice/auth/sessions` returns the identical `401 auth.invalid_credentials` for an unknown email, a wrong password and a suspended account, in constant time. And a citizen requesting a conversation that belongs to another session gets `404 conversation.not_found`, not `403` — a `403` would confirm the id is real.

### 2.3 HTTP status codes

Success:

| Status | Used for |
|---|---|
| `200 OK` | Reads; updates that return the new representation; state transitions that complete synchronously |
| `201 Created` | Resource created. `Location` header points at it. Body is the created resource. |
| `202 Accepted` | Async work started (re-index, evaluation run, campaign send, source ingest). Body is the job resource; `Location` points at `…/jobs/{id}`. |
| `204 No Content` | Deletes; and idempotent no-op transitions (disabling an already-disabled channel) |
| `304 Not Modified` | `If-None-Match` on cacheable config (widget bootstrap, resolved theme, user-guide entries) |

Errors:

| Status | Meaning here | Representative codes |
|---|---|---|
| `400` | Malformed at the protocol level — unparseable JSON, bad cursor, missing required header | `request.malformed_body`, `pagination.cursor_invalid`, `idempotency.key_required` |
| `401` | **No valid session.** The caller has not proven who they are, or the session expired, was revoked, or needs a second factor. Always with `WWW-Authenticate`. | `auth.session_required`, `auth.session_expired`, `auth.session_revoked`, `auth.invalid_credentials`, `auth.totp_required` |
| `403` | **Authenticated but not allowed.** Identity is established; the permission, assurance level, tenant scope or tool binding is not. | `authz.permission_denied`, `authz.tenant_mismatch`, `authz.assurance_insufficient`, `tools.not_bound`, `widget.domain_not_allowed` |
| `404` | Not found, or found in another tenant, or found but not visible to this session. Indistinguishable on purpose. | `agent.not_found`, `conversation.not_found` |
| `405` | Method not allowed on an existing path. `Allow` header set. | `request.method_not_allowed` |
| `409` | Real state conflict — the request is well-formed and authorized but contradicts current state | `governance.policy_locked`, `channels.template_not_approved`, `agent.already_published`, `concurrency.stale_write`, `evaluation.case_already_added`, `idempotency.request_in_progress` |
| `410` | Gone — a conversation past retention, a purged transcript, an expired export | `conversation.expired`, `export.expired` |
| `413` | Body over the cap | `request.payload_too_large` |
| `415` | Unsupported `Content-Type` | `request.unsupported_media_type` |
| `422` | Well-formed, semantically invalid — field validation, or a business rule the payload cannot satisfy | `validation.failed`, `idempotency.key_reused`, `flow.escape_node_required`, `theming.contrast_violation` |
| `428` | `If-Match` required and absent on a guarded resource | `concurrency.precondition_required` |
| `429` | Rate limit or quota exceeded. Always with `Retry-After` and `RateLimit-*`. | `rate_limit.exceeded`, `quota.tenant_exceeded`, `quota.cost_ceiling_exceeded` |
| `499` | *(logged, not returned)* Client disconnected mid-SSE. Recorded so an abandoned turn is distinguishable from a failed one in B1 tab 2's `Abandoned` outcome. | — |
| `500` | Unhandled. Body carries `code`, `traceId` and nothing else useful. | `internal.error` |
| `501` | A configured-but-unimplemented adapter path (e.g. Emirates ID scan while its adapter is absent) | `adapter.not_implemented` |
| `502` | A dependency returned an invalid or unusable response | `upstream.invalid_response` |
| `503` | Dependency unavailable, breaker open, or the service is draining. `Retry-After` set. | `upstream.unavailable`, `upstream.circuit_open`, `service.draining` |
| `504` | Dependency timed out | `upstream.timeout` |

`401 vs 403` is decided by one question and never fudged: **is the principal established?** If not → `401`, and the UI must re-authenticate. If yes → `403`, and re-authenticating is pointless; the UI must say what permission is missing. A `403` from the backoffice always names the required permission in `meta`, because "Forbidden" with no further information generates a support ticket every time:

```json
{
  "status": 403, "code": "authz.permission_denied",
  "title": "Permission denied",
  "detail": "This action requires the 'agents.publish' permission.",
  "meta": { "requiredPermission": "agents.publish", "grantedByRoles": ["Super Admin", "Entity Admin"] }
}
```

`grantedByRoles` is safe to disclose — it is the B9 matrix, which is product documentation, not a secret — and it turns a dead end into "ask an Entity Admin".

### 2.4 Vendor failures become SHJ3 codes

A failure inside OpenRouter, OpenAI, Cohere, Neo4j, Qdrant, an MCP server, the BSP or a payment gateway is caught in the **outbound adapter** and re-raised as a domain error. The vendor's status code, message, headers and request id never cross the adapter boundary outward. The vendor detail is logged, once, at `warn`/`error`, against the trace id — so an operator can find it in 5 seconds and a caller can never see it.

| Real failure | Client sees |
|---|---|
| OpenRouter `429 rate_limit_exceeded` | `503 model.unavailable` after the per-agent fallback model (B3 step 3) has also failed; the trace records `degraded: primary_model_failed` |
| OpenRouter `502`, upstream provider down | `503 model.unavailable` |
| OpenRouter timeout > 60 s | `504 model.timeout` |
| OpenAI embeddings `401 invalid_api_key` | `503 embedding.unavailable` — never `401`, which would tell the caller a credential is wrong |
| OpenAI embeddings `400 context_length_exceeded` | `422 knowledge.chunk_too_large`, with the chunk index in `meta` |
| Cohere rerank unavailable | **Not an error.** Retrieval degrades to unreranked hybrid results and sets `degraded: ["reranker_unavailable"]` on the response ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 6). A rerank outage must not fail a citizen conversation. |
| Neo4j `ServiceUnavailable` | `503 knowledge.graph_unavailable` |
| Qdrant collection missing | `503 knowledge.index_unavailable` (an operational fault, not a client error) |
| MCP server TLS handshake failure | `502 tools.mcp_connect_failed`, `meta.reason: "tls"` — a reason token, not the OpenSSL string |
| API connector returns `500` twice | `503 tools.connector_failed`; the breaker (B5 tab 4) counts it |
| Payment gateway declines a card | `422 payments.declined`, `meta.reason: "insufficient_funds"` — a normalised token from a closed set, never the acquirer's text |
| SQL Server deadlock, retried and failed | `503 internal.transient` |

`meta.reason` values are drawn from an SHJ3-owned closed vocabulary and are part of this contract. Adding a vendor never adds a reason token.

### 2.5 Error code register

Complete list of codes the system defines. Codes are stable; new ones may be appended.

**Request / protocol**

| Code | Status | Meaning |
|---|---|---|
| `request.malformed_body` | 400 | Body is not parseable as the declared type |
| `request.unsupported_media_type` | 415 | `Content-Type` not supported |
| `request.payload_too_large` | 413 | Over the per-surface cap |
| `request.method_not_allowed` | 405 | Path exists, method does not |
| `request.header_invalid` | 400 | A required header is malformed |
| `validation.failed` | 422 | One or more field errors; see `errors[]` |
| `pagination.cursor_invalid` | 400 | Cursor unparseable, expired or foreign |
| `pagination.cursor_filter_mismatch` | 400 | Cursor does not match the supplied filters |
| `concurrency.stale_write` | 409 | `If-Match` did not match current `ETag` |
| `concurrency.precondition_required` | 428 | `If-Match` mandatory on this resource |
| `idempotency.key_required` | 400 | Missing on a mandatory endpoint |
| `idempotency.key_reused` | 422 | Same key, different body |
| `idempotency.request_in_progress` | 409 | First request with this key still running |

**Authentication / authorization**

| Code | Status | Meaning |
|---|---|---|
| `auth.session_required` | 401 | No session presented |
| `auth.session_expired` | 401 | Session TTL elapsed |
| `auth.session_revoked` | 401 | Logged out, suspended (B9), or password rotated |
| `auth.invalid_credentials` | 401 | Email/password wrong, unknown, or account not active — indistinguishable |
| `auth.totp_required` | 401 | Password accepted, second factor outstanding |
| `auth.totp_invalid` | 401 | Wrong or reused TOTP code |
| `auth.totp_enrolment_required` | 401 | Privileged role without an enrolled authenticator |
| `auth.account_locked` | 401 | Progressive lockout after repeated failures |
| `authz.permission_denied` | 403 | Principal lacks the required B9 permission |
| `authz.tenant_mismatch` | 403 | Payload attempted to name a tenant (§12 invariant 1) |
| `authz.assurance_insufficient` | 403 | Step-up required (B11 tab 2) |
| `authz.role_immutable` | 403 | Attempt to edit a system role's locked cell |

**Conversation / public surface**

| Code | Status | Meaning |
|---|---|---|
| `conversation.not_found` | 404 | Unknown, other session's, or other tenant's |
| `conversation.expired` | 410 | Past transcript retention (B14 tab 4) |
| `conversation.closed` | 409 | Turn posted to a closed conversation |
| `conversation.turn_in_progress` | 409 | A turn is already streaming on this conversation |
| `conversation.handover_active` | 409 | Composer is paused; a human holds the conversation (A3) |
| `conversation.channel_disabled` | 403 | Channel set to Disabled; new conversations refused (B10 tab 1) |
| `conversation.session_window_closed` | 409 | WhatsApp 24-hour window elapsed; a template is required |
| `feedback.already_recorded` | 409 | Second differing feedback on the same turn |
| `widget.domain_not_allowed` | 403 | `Origin` not in B10 tab 2's allowed domains |
| `speech.unsupported_audio` | 422 | Codec/duration outside limits |
| `speech.tts_unavailable` | 503 | Voice synthesis dependency down |
| `handover.unavailable` | 409 | Outside staffed hours (B10 tab 1) |

**Agents / orchestration**

| Code | Status | Meaning |
|---|---|---|
| `agent.not_found` | 404 | — |
| `agent.already_published` | 409 | Publish on a published version |
| `agent.not_published` | 409 | Unpublish on a draft |
| `agent.archived` | 409 | Mutation on an archived agent |
| `agent.version_is_current` | 409 | Rollback to the current version |
| `agent.publish_gate_blocked` | 409 | B13 gate refused the publish; `meta` names set, score, threshold |
| `agent.draft_incomplete` | 422 | Publish attempted with unsatisfied wizard steps; `meta.missingSteps` |
| `agent.locale_gate_blocked` | 409 | Bound locale below 100% translated (B10 tab 5 → B13 tab 3) |
| `orchestration.hop_ceiling_exceeded` | 200 + SSE `error` | Max hops reached mid-turn (B4) |
| `orchestration.loop_detected` | 200 + SSE `error` | Loop ceiling reached (B4) |
| `orchestration.cost_ceiling_exceeded` | 200 + SSE `error` | Per-turn cost ceiling reached (B4) |
| `orchestration.no_agent_matched` | 200 + SSE | Router found no agent; fallback agent used, or refusal |
| `model.unavailable` | 503 | Primary and fallback chat models both failed |
| `model.timeout` | 504 | Chat model exceeded the turn budget |
| `guardrail.blocked_input` | 200 + SSE `error` | Prompt-injection or scope filter refused the turn (B12) |
| `guardrail.blocked_output` | 200 + SSE `error` | Post-check refusal — grounding below threshold |

**Knowledge / retrieval**

| Code | Status | Meaning |
|---|---|---|
| `knowledge.source_not_found` | 404 | — |
| `knowledge.source_unsupported_type` | 422 | Type outside the B6 tab 1 set |
| `knowledge.source_unreachable` | 502 | Crawl target not fetchable |
| `knowledge.chunk_too_large` | 422 | Chunk exceeds the embedding model's context |
| `knowledge.embedding_model_mismatch` | 409 | Query embedded with a model other than the collection's ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 3) |
| `knowledge.reindex_in_progress` | 409 | Re-index requested while one is running for the same scope |
| `knowledge.graph_unavailable` | 503 | Neo4j down |
| `knowledge.index_unavailable` | 503 | Qdrant down |
| `knowledge.node_not_found` | 404 | — |
| `knowledge.merge_invalid` | 422 | Merge candidates not a detected duplicate pair, or same node |
| `knowledge.conflict_not_found` | 404 | — |
| `knowledge.conflict_policy_requires_admin` | 409 | Policy is *Always ask an admin*; automatic resolution refused |
| `embedding.unavailable` | 503 | Embedding provider down |
| `retrieval.query_too_long` | 422 | Over the query length cap |

**Tools**

| Code | Status | Meaning |
|---|---|---|
| `tools.mcp_server_not_found` | 404 | — |
| `tools.mcp_connect_failed` | 502 | Handshake/auth failure; `meta.reason` from a closed set |
| `tools.mcp_discovery_empty` | 502 | Connected but advertised no tools |
| `tools.connector_not_found` | 404 | — |
| `tools.connector_failed` | 503 | Connector call failed |
| `tools.connector_untested` | 409 | Binding an untested connector to a published agent |
| `tools.not_bound` | 403 | Tool discovered but not bound to this agent (B3 step 4 tool-permission boundary) |
| `tools.invocation_timeout` | 504 | Tool exceeded its budget |
| `upstream.circuit_open` | 503 | Breaker open; fallback served (B5 tab 4) |
| `tools.breaker_not_found` | 404 | — |

**Flows / handover**

| Code | Status | Meaning |
|---|---|---|
| `flow.not_found` | 404 | — |
| `flow.escape_node_required` | 422 | Publish attempted without a free-text escape reachable from every node (B7) |
| `flow.graph_invalid` | 422 | Unreachable node, dangling edge, or cycle without an exit |
| `flow.node_not_found` | 404 | — |
| `handover.ticket_not_found` | 404 | — |
| `handover.ticket_already_claimed` | 409 | Another agent claimed it |
| `handover.agent_offline` | 409 | Claim attempted while presence is Offline |
| `routing_rule.not_found` | 404 | — |
| `routing_rule.order_conflict` | 409 | Reorder based on a stale order (`If-Match`) |
| `routing_rule.operator_invalid` | 422 | Operator not permitted for the attribute (B8: `>` only for Wait time) |

**Channels**

| Code | Status | Meaning |
|---|---|---|
| `channel.not_found` | 404 | — |
| `channel.agent_required` | 422 | Setting a channel Live with no bound agent |
| `channels.template_not_found` | 404 | — |
| `channels.template_not_approved` | 409 | Campaign enable/send with a Pending or Rejected template (B10 tab 3→4) |
| `channels.template_duplicate_name` | 409 | Template name already submitted |
| `channels.optin_missing` | 422 | Recipient has no recorded opt-in at send time |
| `channels.quiet_hours` | 409 | Send inside 21:00–07:00 `Asia/Dubai` |
| `channels.campaign_blocked` | 409 | Campaign in Blocked state |
| `channels.domain_invalid` | 422 | Allowed-domain entry not a valid host |
| `channels.locale_not_found` | 404 | — |
| `channels.fallback_locale_required` | 422 | Removing the only fallback locale |
| `webhook.signature_invalid` | 403 | HMAC mismatch |
| `webhook.replay_detected` | 409 | Provider message id already processed |
| `webhook.payload_unrecognised` | 422 | Shape not understood; logged and acknowledged |

**Verification / payments**

| Code | Status | Meaning |
|---|---|---|
| `verification.provider_disabled` | 409 | Provider toggled off (B11 tab 1) |
| `verification.challenge_not_found` | 404 | — |
| `verification.challenge_expired` | 410 | OTP window elapsed |
| `verification.code_invalid` | 401 | Wrong OTP |
| `verification.attempts_exhausted` | 429 | Too many OTP attempts; challenge burned |
| `verification.ownership_check_failed` | 403 | Account not owned by the verified identity (B11 tab 1) |
| `verification.stitching_requires_verified` | 409 | Stitch attempted on an anonymous session (B11 tab 5) |
| `payments.gateway_unavailable` | 503 | — |
| `payments.declined` | 422 | Normalised decline reason in `meta.reason` |
| `payments.transaction_not_found` | 404 | — |
| `payments.refund_not_requested` | 409 | Approve/decline on a transaction with no pending refund |
| `payments.refund_already_resolved` | 409 | Second approve/decline |
| `payments.refund_window_expired` | 409 | Outside the refund window |
| `payments.amount_mismatch` | 422 | Refund amount exceeds the settled amount |

**Governance / evaluation / IAM**

| Code | Status | Meaning |
|---|---|---|
| `governance.policy_locked` | 409 | Locked policy toggle attempted (B12 tab 1) |
| `governance.policy_not_found` | 404 | — |
| `governance.override_forbidden_for_locked_policy` | 422 | Override created against a locked policy |
| `governance.override_reason_required` | 422 | Override without a stated reason (B12 tab 2) |
| `governance.promotion_not_found` | 404 | — |
| `governance.promotion_already_resolved` | 409 | Second approve/reject |
| `governance.promotion_self_approval` | 403 | Requester approving their own promotion |
| `governance.promotion_path_invalid` | 422 | Not an adjacent environment hop (B14 tab 1) |
| `governance.audit_log_immutable` | 405 | Any write attempt other than append |
| `governance.erasure_conflicts_with_retention` | 409 | Erasure request touching transaction records under the 7-year carve-out |
| `evaluation.golden_set_not_found` | 404 | — |
| `evaluation.case_already_added` | 409 | Conversation already in this set (B1 → B13) |
| `evaluation.run_in_progress` | 409 | Run requested while one is active for the same scope |
| `evaluation.run_not_found` | 404 | — |
| `user.not_found` | 404 | — |
| `user.email_taken` | 409 | — |
| `user.already_suspended` | 409 | — |
| `user.last_super_admin` | 422 | Suspending, removing or demoting the final Super Admin |
| `team.not_found` | 404 | — |
| `team.has_members` | 409 | Deleting a non-empty team |
| `role.not_found` | 404 | — |
| `role.in_use` | 409 | Deleting a role held by an active user |
| `role.name_taken` | 409 | — |

**Theming / user guide**

| Code | Status | Meaning |
|---|---|---|
| `theming.skin_not_found` | 404 | — |
| `theming.skin_name_taken` | 409 | — |
| `theming.skin_immutable` | 409 | Editing a system skin (`default`, `dark`) |
| `theming.schema_invalid` | 422 | Imported JSON failed the skin schema |
| `theming.contrast_violation` | 422 | Fails WCAG 2.1 AA; `errors[]` names each pair and its ratio |
| `theming.unknown_token` | 422 | Import referenced a token outside the registry |
| `theming.asset_invalid` | 422 | Logo/favicon wrong type or over size |
| `userguide.entry_not_found` | 404 | — |
| `userguide.deep_link_unresolvable` | 404 | App path has no guide entry |
| `userguide.screenshot_missing` | 409 | Entry published without a current screenshot |

**Infrastructure**

| Code | Status | Meaning |
|---|---|---|
| `rate_limit.exceeded` | 429 | Per-session/tenant/key limit |
| `quota.tenant_exceeded` | 429 | Tenant token or spend quota |
| `quota.cost_ceiling_exceeded` | 429 | Per-agent cost ceiling (B4) |
| `upstream.unavailable` | 503 | Generic dependency down |
| `upstream.timeout` | 504 | — |
| `upstream.invalid_response` | 502 | — |
| `internal.error` | 500 | Unhandled |
| `internal.transient` | 503 | Retryable internal fault (deadlock, transient store failure) |
| `service.draining` | 503 | Pod shutting down; `Retry-After: 1` |
| `adapter.not_implemented` | 501 | Configured adapter has no implementation |

### 2.6 Errors mid-stream

Once an SSE response has begun, the status line is already `200`. An error therefore arrives as an `error` **event** carrying the same problem document, followed by stream close. Clients must treat `event: error` as equivalent to a failed request. Every SSE stream terminates with exactly one of `done` or `error` — never silence. This is covered in §5.2.

---

## 3. Authentication & authorization

Two unrelated identity problems, kept apart ([ADR-0006](./adr/0006-identity-behind-a-port.md)): **staff** authenticate to the backoffice; **citizens** are anonymous by default and become *verified* before money moves.

### 3.1 Sessions are opaque, server-side, in Redis

**No JWT carries a claim this application interprets.** A session is a 256-bit random opaque id in a cookie; all state lives in Redis under `{tenant}:session:{id}`. Recorded in [ADR-0006](./adr/0006-identity-behind-a-port.md) rule 2.

Three consequences that are the entire reason for the choice:

1. **Revocation is immediate.** Suspending a user in B9 deletes their sessions in the same transaction as the status change. There is no token that stays valid until expiry.
2. **OIDC arrival changes only session *creation*.** `LocalPasswordProvider` → `OidcProvider` swaps how a `Principal` is minted. Nothing that *reads* a session changes.
3. **Permissions are read fresh, per request, from the session record** — never decoded from a bearer token the client holds. A permission-matrix edit in B9 tab 3 takes effect on the next request, not on the next login.

| Property | Staff session | Citizen session |
|---|---|---|
| Cookie | `shj3_bo` | `shj3_cs` |
| Attributes | `HttpOnly; Secure; SameSite=Strict; Path=/` | `HttpOnly; Secure; SameSite=None; Path=/api/public` — `None` because the widget runs cross-site inside `sharjah.ae`; paired with an `Origin` allow-list (B10 tab 2) and CSRF tokens |
| Idle TTL | 30 min, sliding | 24 h, sliding |
| Absolute TTL | 12 h | 30 d |
| Redis key | `{tenant}:session:{id}` | `public:cs:{id}` (tenant resolved from channel config, not from the citizen) |
| CSRF | Double-submit token + `Origin` check on unsafe methods | Same, plus the domain allow-list |
| Binding | Rotated on privilege change; bound to a coarse client fingerprint (UA family + IP /24) — a mismatch forces re-authentication rather than silently continuing |

### 3.2 Establishing a staff session

```http
POST /api/backoffice/auth/sessions
Content-Type: application/json

{ "email": "sara.almazrouei@shj.ae", "password": "…" }
```

Password verified with **Argon2id** against `LocalCredential` — a table owned solely by the local adapter; the `User` record has no `password_hash` column ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 3), so SSO arrival drops a table rather than restructuring one.

Outcomes:

| Situation | Response |
|---|---|
| Correct, role requires TOTP (any role with `agents.publish` or `users.manage`) | `200` with `{"status":"totp_required","challengeId":"chg_…","expiresAt":"…"}`. A **partial** session cookie is set, scoped to the TOTP route only; it grants no permissions. |
| Correct, TOTP not required | `201` + session cookie + the `Principal` body |
| Wrong password, unknown email, `Invited`, or `Suspended` | `401 auth.invalid_credentials`. Identical body, identical timing (constant-time compare plus a fixed floor of work on the unknown-email path). |
| Privileged role, no authenticator enrolled | `401 auth.totp_enrolment_required` + `enrolmentToken` — forced enrolment on invite acceptance ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 4) |
| Too many failures | `401 auth.account_locked`, progressive backoff 1s → 2s → 4s … capped, then a 15-minute lock. `429` is deliberately **not** used: it would distinguish "real account under attack" from "unknown email". |

```http
POST /api/backoffice/auth/sessions/totp
{ "challengeId": "chg_…", "code": "492013" }
```

`201` + full session cookie, or `401 auth.totp_invalid`. Codes are single-use — a replayed code inside its window is `auth.totp_invalid`, not a success. Five failures burn the challenge (`401 auth.totp_invalid`, `meta.challengeBurned: true`); the user restarts at the password step. TOTP: 30-second step, ±1 step skew, SHA-1/6 digits (RFC 6238 baseline for authenticator-app compatibility).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/backoffice/auth/sessions` | none | Password step |
| `POST` | `/api/backoffice/auth/sessions/totp` | partial session | Second factor |
| `GET` | `/api/backoffice/auth/session` | session | Current `Principal` — the backoffice bootstrap call |
| `DELETE` | `/api/backoffice/auth/session` | session | Log out; deletes the Redis record |
| `DELETE` | `/api/backoffice/auth/sessions` | session | Log out everywhere (all this user's sessions) |
| `POST` | `/api/backoffice/auth/totp/enrolment` | enrolment token or session | Begin enrolment; returns secret + otpauth URI |
| `POST` | `/api/backoffice/auth/totp/enrolment/confirm` | enrolment token or session | Confirm with a code; returns one-time recovery codes |
| `POST` | `/api/backoffice/auth/password` | session + TOTP | Change password; rotates the session, revokes all others |

There is no password reset by email link alone ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 4). Reset requires the emailed link **and** a second factor; without an enrolled authenticator, reset is a `users.manage` action performed in B9.

### 3.3 The `Principal`

The single object feature code sees. It says **who** the caller is and **what** they may do — and nothing about **how** they authenticated. No feature module may reference a password, cookie, token or OIDC claim ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 1).

```typescript
/** Established by the inbound adapter, bound to request scope via AsyncLocalStorage.
 *  Contains no authentication mechanism — that is the IdentityProvider adapter's private business. */
export interface Principal {
  readonly kind: 'staff' | 'citizen' | 'service';
  readonly id: PrincipalId;                    // 'usr_01JB…' | 'cs_01JB…' | 'svc_shj3_web'
  readonly tenantId: TenantId;                 // resolved server-side. never from the request. §12.1
  readonly displayName: string | null;         // null for anonymous citizens
  readonly roles: readonly RoleName[];         // ['Agent Designer'] — B9 tab 1
  readonly permissions: ReadonlySet<Permission>; // effective, flattened from roles. B9 tab 3
  readonly teamIds: readonly TeamId[];         // B9 tab 2 — entity scope within the tenant
  readonly assurance: AssuranceLevel;          // B11 tab 2
  readonly locale: 'en' | 'ar';
  readonly sessionId: SessionId;
  readonly issuedAt: string;                   // RFC 3339 UTC
  readonly expiresAt: string;
}

/** The 8 permissions of B9 tab 3. This union is the complete authorization vocabulary. */
export type Permission =
  | 'dashboard.view'      // View dashboard
  | 'agents.manage'       // Manage agents
  | 'agents.publish'      // Publish agents
  | 'knowledge.manage'    // Manage knowledge
  | 'routing.manage'      // Manage routing rules
  | 'escalations.handle'  // Handle escalations
  | 'users.manage'        // Manage users & teams
  | 'analytics.view';     // View analytics

/** B11 tab 2's ladder. Monotonic: each level satisfies every level below it. */
export type AssuranceLevel =
  | 'anonymous'           // View bill balance
  | 'identified'          // self-asserted account number, not proven  [ASSUMPTION]
  | 'verified'            // Link a utility account — UAE PASS / mock verified identity
  | 'verified_otp';       // Initiate a payment; Change registered mobile
```

Deliberately **absent**: password hash, TOTP secret, cookie value, OIDC claims, `authMethod`, IdP name, refresh token. If a feature ever needs one of those, the design is wrong.

`kind: 'service'` is the `shj3-web` → `shj3-ai` principal, established by the mTLS client certificate's SAN. It carries the acting user's tenant and permissions forwarded from the originating request, so `shj3-ai` enforces the same tenant scope rather than trusting a body field.

### 3.4 Authorization — deny by default, in the inbound adapter

The 7×8 matrix from B9 tab 3 is evaluated against `Principal.permissions`, in the inbound adapter, before any application code runs. Authorization is entirely separate from authentication ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 7): swapping identity providers does not touch it.

```typescript
// app/api/backoffice/agents/[id]/publish/route.ts
export const POST = withBackofficeRoute(
  {
    permission: 'agents.publish',          // ← declared. no permission key ⇒ route does not compile.
    idempotent: true,                      // Idempotency-Key required
    audit: { action: 'agent.published', target: (p) => `agent:${p.id}` },
  },
  async ({ principal, params, body }) => publishAgent.execute({ principal, agentId: params.id, ...body }),
);
```

The mechanism, and why it is structural rather than disciplinary:

1. `withBackofficeRoute` takes a **required** `permission` field typed as `Permission`. A route handler that omits it fails to typecheck; a route file that does not use the wrapper fails a lint rule (`shj3/backoffice-route-must-declare-permission`) that scans `app/api/backoffice/**/route.ts`. **There is no path to an unguarded backoffice route** — deny by default is enforced by the type system and the linter, not by remembering.
2. The check is `principal.permissions.has(required)`. Missing → `403 authz.permission_denied` with `meta.requiredPermission`. No handler code runs; no query is issued.
3. **Team/entity scope is a second, separate check inside the use case.** `agents.manage` says *may manage agents*; the agent's owning entity must also be in `principal.teamIds`, unless the principal's team has `entityScope: 'all'` (the `Platform` team, B9 tab 2). Cross-entity access within one tenant is `403 authz.permission_denied` with `meta.reason: "entity_scope"`. Note the ordering: permission first, then scope, then existence — so a scope failure never doubles as an existence oracle.
4. **The client-side check is decoration.** The backoffice hides controls the principal cannot use; the server check is the real one ([`architecture.md`](./architecture.md) §9). Every backoffice route is covered by a test that calls it with each of the 7 roles and asserts allow/deny against the B9 matrix — the matrix is a fixture, so a matrix change that breaks a route breaks a test.
5. **Read routes are permissioned too.** `dashboard.view` gates B1's overview; `analytics.view` gates the metric and explorer reads. A `Live Agent` (no `dashboard.view` in the B9 matrix) receives `403` on `/api/backoffice/metrics/overview` and lands directly in B8.
6. **Cross-tenant platform administration is a compound gate, not a permission alone (§6.14).** `platform:operate` is checked **together with** the principal's own tenant being the real Platform tenant (`RequirePlatformOperator`) — a permission alone is not the boundary, because any tenant's own Super Admin can already toggle any matrix cell for their own tenant at runtime (point 4 above). `platform:operate` is deliberately absent from every tenant's seeded role matrix; every call under §6.14 writes an audit entry.

Composite requirements — where one route needs two permissions — are declared as an array and evaluated as **AND**: `permission: ['agents.publish', 'agents.manage']`. There is no OR form; a route that would need one is two routes.

### 3.5 Citizen authorization is assurance, not permissions

Citizens have no permissions. They have an `assurance` level, checked against B11 tab 2's step-up rules **before** the tool call, never after ([`architecture.md`](./architecture.md) §8):

| Action (B11 tab 2) | Required assurance | Below it |
|---|---|---|
| View bill balance | `anonymous` | — |
| Link a utility account | `verified` | `403 authz.assurance_insufficient`, `meta.required: "verified"` |
| Initiate a payment | `verified_otp` | `403 authz.assurance_insufficient`, `meta.required: "verified_otp"`, `meta.challengeUrl` |
| Change registered mobile | `verified_otp` | as above |

The runtime treats this as a **pause, not a failure**: the turn emits a `step_up_required` SSE event with the challenge reference and the tool call is not attempted. This is the seam A2 step 3 makes visible with `awaiting slot: account_number`.

When B11 tab 1's **account-ownership check** is on, `verified_otp` alone is insufficient — the supplied account number must also resolve to the verified identity, else `403 verification.ownership_check_failed`. With the toggle off, that check is skipped; the wireframe calls this the most consequential toggle in the prototype, so its state is written to the audit log on every change and surfaced in B14 tab 2.

### 3.6 Suspension ends a session immediately

B9's `Suspend` is not a flag checked at next login. `POST /api/backoffice/iam/users/{id}/suspend` performs, in one transaction plus one atomic Redis operation:

1. `User.status = 'suspended'` (SQL Server).
2. Audit entry `user.suspended` — same transaction (§12 invariant 3).
3. On commit, `DEL {tenant}:session:*` for that user id via the maintained `{tenant}:user-sessions:{userId}` set, in a single `UNLINK`.

The user's next request — including one already in flight against another pod, since the session read happens per request — is `401 auth.session_revoked`. Reactivation does not restore sessions; the user signs in again. Role and permission changes (B9 tab 3) do **not** kill the session: permissions are re-read per request, so the change simply takes effect on the next call. Only status changes and password rotation revoke.

---

## 4. Public / citizen API

`shj3-web`, prefix `/api/public/v1`. Small surface, high traffic, **hostile input**. Every endpoint here assumes the caller is an attacker until proven otherwise.

### 4.1 Cross-cutting rules on this surface

- **Origin allow-list (B10 tab 2).** Every request from the widget must carry an `Origin` in the tenant's allowed-domains list (`sharjah.ae`, `services.shj.ae`, chips editable in the widget studio). Enforcement is threefold: the `Access-Control-Allow-Origin` reflection only echoes allow-listed origins; a non-preflight request with a disallowed `Origin` is `403 widget.domain_not_allowed`; and the widget bootstrap script itself refuses to initialise if `location.origin` is not in the list it was served. Matching is exact host or a single-label wildcard (`*.sharjah.ae`); a bare suffix match is not used, because `evil-sharjah.ae` would pass it.
- **No tenant in the request.** The citizen never names a tenant. It is resolved from the widget's public `channelKey` (issued per channel configuration, B10 tab 1) or, on WhatsApp, from the receiving business phone number id. §12 invariant 1.
- **Rate limited** per session, per IP and per channel key (§11). Every response carries `RateLimit-*`.
- **No enumeration.** Every not-found on this surface is `404`, uniform, regardless of whether the resource exists in another session or another tenant.
- **PII is masked before persistence** (§12 invariant 4). A turn containing an account number is stored masked; the unmasked value exists only in memory for the duration of the tool call that needs it, and is never written to a log, a trace or a transcript.
- **CSP-friendly.** Responses are JSON or SSE only; no HTML is served from this prefix except the widget loader, which carries `Content-Security-Policy` and `X-Frame-Options` appropriate to being embedded.

### 4.2 Endpoints

| Method | Path | Auth | Purpose | Wireframe |
|---|---|---|---|---|
| `GET` | `/api/public/v1/widget/bootstrap?channelKey=…` | none | One call returning everything the widget needs to paint: greeting text, disclaimer text, composer placeholder, accent colour, launcher position, default state, locale + direction, resolved theme tokens, suggestion chips, whether TTS and handover are currently offered. `ETag` + `Cache-Control: public, max-age=60`. | A1; B10 tab 2; B10 tab 5 |
| `POST` | `/api/public/v1/conversations` | none | Open a conversation. Sets the citizen-session cookie if absent. Returns `conversationId`, the greeting turn and chips. `403 conversation.channel_disabled` if the channel is Disabled (B10 tab 1). | A1 |
| `GET` | `/api/public/v1/conversations/{id}` | citizen session | Rehydrate the thread on reload — turns, pending slot, handover state. Cursor-paginated turns. | A1 expanded/docked retains thread |
| `POST` | `/api/public/v1/conversations/{id}/turns` | citizen session | **Post a turn. SSE response.** See §4.3. | A2 |
| `GET` | `/api/public/v1/conversations/{id}/turns/{turnId}/stream` | citizen session | Re-attach to an in-flight turn after a dropped connection, replaying from `Last-Event-ID`. | A2 |
| `POST` | `/api/public/v1/conversations/{id}/close` | citizen session | End the conversation. Open conversations are allowed to finish even if the channel was disabled mid-flight (B10 tab 1 rule). | B10 tab 1 |
| `GET` | `/api/public/v1/suggestions?channelKey=…&conversationId=…` | none / session | Suggestion chips. Config-driven from the Quick Actions manager, **not** model-generated; contextual chips for the current flow node when a conversation id is supplied. | A1 five chips; B7 greeting node |
| `PUT` | `/api/public/v1/turns/{turnId}/feedback` | citizen session | Per-message thumbs up/down. `PUT` because it is idempotent and re-settable: `{"rating":"up"\|"down","reasonCode":null,"comment":null}`. Feeds B1 tab 3's review queue. Changing an existing rating is allowed; a third distinct submission within 1 s is `409 feedback.already_recorded` (double-click guard). | A2 message meta; B1 tab 3 |
| `DELETE` | `/api/public/v1/turns/{turnId}/feedback` | citizen session | Withdraw feedback. `204`. | A2 |
| `POST` | `/api/public/v1/turns/{turnId}/speech` | citizen session | **TTS.** Returns `audio/mpeg`, or `202` + poll for long text. Voice selected by locale (Aria EN / Layla AR, B10 tab 5). Response is content-addressed and cached (`Cache-Control: private, max-age=3600`, `ETag` = hash of text+voice) so replaying the speaker icon costs nothing. `503 speech.tts_unavailable` degrades the icon rather than failing the turn. | A1/A2 speaker icon; B10 tab 5 |
| `POST` | `/api/public/v1/speech/transcriptions` | citizen session | **STT commit.** `multipart/form-data`, one audio blob ≤ 60 s, ≤ 5 MiB. Returns the final transcript for the composer. **[ASSUMPTION]** Interim "Listening — …" transcription in A3 is done in-browser (Web Speech API) where available; only the committed utterance is uploaded. This avoids adding a WebSocket surface for a preview the user can already see locally. Where the browser has no STT, the mic falls back to record-then-upload with a visible "processing" state. | A3 live transcription |
| `POST` | `/api/public/v1/conversations/{id}/handover` | citizen session | Request a human. Returns `{ticketId, queuePosition, estimatedWaitSeconds, contextTransferred:true}`. Outside staffed hours → `409 handover.unavailable` with the configured out-of-hours message (B10 tab 1). Transfers transcript, identity state and pending slot — the handover is never a cold start. | A3 escalation; B8 queue |
| `GET` | `/api/public/v1/conversations/{id}/events` | citizen session | SSE side-channel for state the citizen did not initiate: queue position changes, agent joined, agent message, composer paused/resumed, session-window warnings. Separate from the turn stream so it survives between turns. | A3 queue position |
| `POST` | `/api/public/v1/conversations/{id}/verification/challenges` | citizen session | Begin step-up (B11 tab 2). `{level:"verified"\|"verified_otp"}` → `{challengeId, method:"uae_pass"\|"otp", redirectUrl?, maskedTarget:"•••• 4821", expiresAt}`. Behind `VerificationProvider`; mock adapter now, UAE PASS later. | B11 tabs 1–2 |
| `POST` | `/api/public/v1/conversations/{id}/verification/challenges/{cid}/verify` | citizen session | Submit the OTP. Success raises `Principal.assurance` and resumes the paused tool call. 5 attempts then `429 verification.attempts_exhausted`; the challenge is burned. | B11 tab 2 |
| `POST` | `/api/public/v1/conversations/{id}/payments/intents` | citizen session, `verified_otp` | Create a payment intent. **`Idempotency-Key` required.** Returns a gateway redirect/token, never gateway credentials. Rejected with `403 authz.assurance_insufficient` if assurance is short — checked *before* the intent is created. | B11 tabs 2–4 |
| `GET` | `/api/public/v1/conversations/{id}/receipt/{txnRef}` | citizen session | In-conversation receipt (B11 tab 3 receipt settings). PDF email is a separate outbound job, not this endpoint. | B11 tab 3 |
| `POST` | `/api/public/v1/conversations/{id}/refund-requests` | citizen session, `verified_otp` | Citizen-initiated refund request, if *allow refund requests from the assistant* is on. Creates the pending item that B11 tab 4 approves or declines. | B11 tabs 3–4 |
| `GET` | `/api/public/v1/theme?channelKey=…` | none | Resolved token set for the widget — user → tenant → system default (§7). `ETag`, 60 s cache. | Phase E |
| `GET` | `/api/public/v1/health` | none | Shallow liveness for the edge only. No dependency detail: a public endpoint must not report which store is down. | — |

**20 endpoints**, plus the two webhook routes in §4.4 and the payment callback in §10.2. That is the whole citizen surface, and it is deliberately small: everything else the assistant does happens inside a turn.

### 4.3 Posting a turn

```http
POST /api/public/v1/conversations/conv_01JBQ7/turns
Content-Type: application/json
Accept: text/event-stream
Cookie: shj3_cs=…
X-CSRF-Token: …

{
  "content": "Pay SEWA Bills",
  "inputMode": "chip",              // "text" | "chip" | "voice" | "list_reply"
  "chipId": "qa_pay_sewa",
  "clientTurnId": "ct_9f2a"         // client-generated, for dedupe on retry
}
```

- `clientTurnId` deduplicates a retried post; a repeat re-attaches to the existing turn's stream instead of creating a second turn.
- A second concurrent turn on the same conversation is `409 conversation.turn_in_progress`. Turns on one conversation are strictly serialised — a partially-completed slot-filling flow cannot be raced.
- While a human holds the conversation (A3), `409 conversation.handover_active`; the composer is paused and citizen input routes through the handover ticket instead.
- `content` is capped at 4,000 characters (`422 validation.failed`). It is treated as **data, never instruction** — the prompt-injection filter (B12, locked) runs on it and on every retrieved passage before the model sees either.
- `Accept: application/json` instead of `text/event-stream` returns the completed turn in one response, after the full pipeline. Provided for the WhatsApp path and for tests; the browser always streams.

`shj3-web` does not implement the pipeline. It authenticates, resolves the tenant, checks the channel and rate limits, then opens `POST /v1/conversations/{id}/turns` on `shj3-ai` and **pipes the SSE stream through**, event for event, adding nothing and removing only internal diagnostic events the citizen surface must not see (§5.2). The event grammar is defined once, in §5.2, and is identical on both hops apart from that filter.

### 4.4 WhatsApp inbound webhook

```
GET  /api/webhooks/whatsapp     — Meta subscription verification
POST /api/webhooks/whatsapp     — inbound messages and status callbacks
```

Unversioned by design: the URL is configured in the Meta app console, outside our deploy cycle. Payload shape changes are absorbed in the adapter.

**Verification handshake (`GET`).** Meta sends `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`. The token is compared in constant time against a secret from the environment; match → `200` with the challenge as `text/plain`; mismatch → `403 webhook.signature_invalid`. No detail, no logging of the supplied token.

**Signature verification (`POST`).** Order matters and is not negotiable:

1. Read the **raw body bytes**. The signature is over bytes, not over re-serialised JSON — the adapter reads the raw stream before any parser touches it.
2. Compute `HMAC-SHA256(appSecret, rawBody)`; compare with `X-Hub-Signature-256: sha256=<hex>` using a constant-time comparison.
3. Missing or mismatched → `403 webhook.signature_invalid`, empty body, and **no parse of the payload**. An unsigned payload is never deserialised, so a parser bug is not reachable by an unauthenticated caller.
4. Body over 512 KiB → `413`, unread beyond the cap.
5. Only then parse.

**Replay protection.** Meta sends no timestamp usable as a freshness bound, so replay defence is message-id dedupe: `SETNX public:wa:msg:{messageId}` with a 72-hour TTL (comfortably over Meta's ~24-hour retry horizon). Already present → `200`, no processing, counted as `webhook.replay_detected` in metrics. The response is `200` rather than `409` deliberately: a `4xx` to Meta triggers redelivery, and redelivering a duplicate is worse than acknowledging it. Every `POST` on this route returns `200` within 5 seconds after enqueuing; message handling is asynchronous. A webhook that does its work inline will be retried into a storm the first time the model is slow.

**Payloads that are not messages** — delivery receipts, read receipts, template status changes — are routed to their handlers. Template status is important: Meta approving `appointment_confirmation` arrives here and drives the B10 tab 3 → tab 4 unblock. Unrecognised shapes are logged with the trace id and acknowledged `200` (`webhook.payload_unrecognised` recorded as a metric, not returned) — a new Meta field must not break inbound messaging.

**The 24-hour session window (A1, B10 tab 3).** WhatsApp permits free-form replies only within 24 hours of the citizen's last message; after that a template is required to re-open. This is enforced at send time, not remembered by the UI:

- Each inbound message sets `public:wa:window:{waId}` with a 24-hour TTL and stamps `sessionWindowExpiresAt` on the conversation.
- An outbound free-form message when the key is absent is refused: `409 conversation.session_window_closed`, `meta.requiredTemplate: true`. The `ChannelTransport` adapter refuses it — so no caller, human agent or campaign can bypass the rule by being written carelessly.
- Human-agent replies from B8 hit the same check. An agent typing into a closed window gets the refusal and a prompt to pick an approved template.
- The window state is surfaced to the citizen UI ("24-hour session window open", A1) and to the agent workspace, because a rule that silently drops messages is worse than one that explains itself.

**Opt-in (B10 tab 3).** With *opt-in required before first message* on, an inbound message from an unknown `waId` with no recorded opt-in receives only the opt-in notice; no agent turn runs. `STOP` (and its Arabic equivalents) revokes the opt-in synchronously, writes a consent-ledger entry (B14 tab 4) and suppresses every future outbound send to that number — checked at send time (§10.3).

**Interactive replies.** WhatsApp has no chip component, so suggestions render as list-message rows (A1). A list reply arrives as `interactive.list_reply.id`, which maps to the same `chipId` the web widget posts. One `inputMode: "list_reply"` value distinguishes them in analytics; the pipeline treats them identically. Channel adaptation is structural, not cosmetic — and it is the transport adapter's job, not the domain's.

---

## 5. Internal API — `shj3-ai`

Prefix `/v1`. **Only `shj3-web` may call it.** mTLS in-cluster; the client certificate's SAN must be `shj3-web.shj3-{env}.svc.cluster.local`, and a `NetworkPolicy` admits ingress from pods labelled `app=shj3-web` only. There is no Ingress and no public DNS for this service. Typed both ways from `/v1/openapi.json` (§1.2).

Every request carries a forwarded principal context in headers — never in the body, never a tenant the caller chose:

| Header | Meaning |
|---|---|
| `X-SHJ3-Principal-Id` | Acting principal (`usr_…` or `cs_…`) |
| `X-SHJ3-Tenant-Id` | Tenant, as resolved by `shj3-web` from the authenticated principal |
| `X-SHJ3-Assurance` | `anonymous` \| `identified` \| `verified` \| `verified_otp` |
| `X-SHJ3-Permissions` | Space-separated effective permissions (backoffice-originated calls only) |
| `traceparent` | W3C trace, continued from the citizen or staff request |

These headers are trusted **because and only because** mTLS established that the caller is `shj3-web`. They are validated for shape, and a request whose tenant is absent or malformed is `400 request.header_invalid` — never defaulted. `shj3-ai` binds the tenant into a `contextvar` and derives its store handles from it ([`architecture.md`](./architecture.md) §5): the Neo4j session opens against `neo4j://…/{tenant}`, the Qdrant collection name is `{tenant}_knowledge`. **The collection name is derived, never taken from input** — that is the whole defence against a crafted collection reference.

### 5.1 `POST /v1/conversations/{id}/turns` — the runtime pipeline

The centre of the system. Implements the six-stage pipeline in [`architecture.md`](./architecture.md) §7.

```http
POST /v1/conversations/conv_01JBQ7/turns HTTP/1.1
Content-Type: application/json
Accept: text/event-stream
X-SHJ3-Tenant-Id: sewa
X-SHJ3-Principal-Id: cs_01JBQ7
X-SHJ3-Assurance: anonymous
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

{
  "turnId": "trn_01JBQ8",
  "content": "Pay SEWA Bills",
  "inputMode": "chip",
  "channel": "web",
  "locale": "en",
  "agentBinding": { "agentId": "agt_billing", "version": "v1.4" },
  "flowState": { "flowId": "flw_pay_utilities", "nodeId": "nd_ask_account", "slots": { "provider": "SEWA" } },
  "history": { "mode": "reference", "conversationId": "conv_01JBQ7" },
  "budget": { "maxHops": 6, "maxToolCalls": 8, "maxCostAed": 0.35, "deadlineMs": 45000 },
  "diagnostics": true
}
```

- `agentBinding` is resolved by `shj3-web` from channel config (B10 tab 1). `shj3-ai` does not re-read configuration tables for a fact it was handed — one owner per fact.
- `history.mode: "reference"` means `shj3-ai` loads prior turns itself (it has read access to conversation turns, [`architecture.md`](./architecture.md) §6). `"inline"` exists for the sandbox and evaluation paths, where there is no persisted conversation.
- `budget` carries B4's ceilings, resolved from the agent version's orchestration config. `shj3-ai` enforces them; it does not invent them.
- `diagnostics: true` populates the trace and sources that A2's rail renders. On the citizen path `shj3-web` requests it — the rail is part of the product — but filters internal-only events before forwarding (§5.2).

The six stages, and what each can do to the response:

| Stage | Module | Failure behaviour |
|---|---|---|
| 1 · Guardrail pre-check | `governance` | Prompt-injection filter and scope restriction. **Locked policies (B12) are structural** — no config read decides whether they run. A block emits `guardrail` then `error` with `guardrail.blocked_input`, persists the turn as `blocked`, and never calls a model. |
| 2 · Route | `orchestration` | Intent → agent(s) + confidence. No match → the configured fallback agent (B4); if none, a refusal turn. Emits `route`. |
| 3 · Execute | ADK — `sequential` \| `parallel` \| `supervisor_worker` | Tool calls (`tools`), retrieval (`knowledge`), flow/slot state (`flows`). The breaker is consulted **before** every tool call (B5 tab 4) — an open breaker serves the configured fallback and emits `tool_call_finished` with `outcome: "circuit_open"` instead of waiting. A ceiling breach emits `error` with the relevant `orchestration.*` code and still persists the partial trace. |
| 4 · Merge | `orchestration` | Conflict/overlap policy per B4. Parallel mode's overlap resolution happens here. |
| 5 · Guardrail post-check | `governance` | Grounding threshold (global 60%, per-agent override 75% for billing — B12 tab 2), PII masking, refusal. Below threshold the answer is **withheld**, a human is offered, and the turn persists as `refused` with `guardrail.blocked_output`. Unresolved source conflicts (B6 tab 4) lower grounding and can trip this — the two screens agree because it is one number. |
| 6 · Stream + persist | `conversation` | Turn, trace and grounding sources written. **PII is masked before the write** (§12 invariant 4), so a transcript is never stored unmasked. |

Execution mode comes from the agent version's configuration (B4); the three modes produce structurally different traces, which is exactly what B4's mode toggle demonstrates.

### 5.2 SSE event grammar

`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `Connection: keep-alive`. Every event has an `id` (monotonic per turn, for `Last-Event-ID` resume), an `event` name and a JSON `data` payload. A `:heartbeat` comment every 15 seconds stops intermediaries closing an idle stream during a long tool call.

| Event | Payload | Forwarded to the citizen? |
|---|---|---|
| `turn_started` | `{turnId, startedAt}` | yes |
| `guardrail` | `{stage:"pre"\|"post", decision:"pass"\|"block"\|"applied", policyId, reason}` | decision + reason only; `policyId` stripped |
| `route` | `{agentId, agentName, confidence, mode, alternatives:[{agentId,confidence}]}` | yes — A2's `router → billing_agent (confidence 0.94)` |
| `agent_started` / `agent_finished` | `{agentId, role:"primary"\|"secondary"\|"supervisor"\|"worker", hop, tokensIn, tokensOut, costAed}` | yes, without cost |
| `tool_call_started` | `{callId, toolName, source:"mcp"\|"connector"\|"skill", serverId?, args}` | yes, `args` **masked** |
| `tool_call_finished` | `{callId, toolName, outcome:"ok"\|"error"\|"timeout"\|"circuit_open", durationMs, retries, errorCode?}` | yes |
| `retrieval` | `{queryId, passageCount, topScore, degraded:[…], graphHops}` | yes |
| `citation` | `{sourceId, sourceName, passageId, score, freshness, entityPath:["Service(Pay utilities bill)","Provider(SEWA)","Fee"]}` | yes — A2's Sources panel |
| `slot_update` | `{slot:"account_number", state:"awaiting"\|"filled"\|"cleared"}` | yes — A2 step 3's `awaiting slot` |
| `step_up_required` | `{level:"verified_otp", action:"initiate_payment", challengeRef}` | yes — pauses before the tool call (B11 tab 2) |
| `flow_escape` | `{fromNodeId, contextPreserved:true}` | yes — A2 step 4 |
| `token` | `{text}` | yes |
| `trace_update` | `{traceId, hops, toolCalls, tokensTotal, costAed, elapsedMs}` | cost stripped |
| `handover_triggered` | `{reason:"tool_failure"\|"user_request"\|"low_confidence", ticketId}` | yes — B7's handover node → B8's three reasons |
| `done` | the full turn envelope (§5.3) | yes, filtered |
| `error` | an RFC 9457 problem document (§2) | yes |

Grammar rules, enforced by a contract test:

1. The first event is always `turn_started`. The last is **exactly one** of `done` or `error`. A stream never ends silently — a client that sees the connection close without a terminal event treats it as `upstream.unavailable` and may re-attach with `Last-Event-ID`.
2. `token` events interleave with `tool_call_*`, `citation` and `trace_update` in real order. Ordering is meaningful: a citation emitted before the token it grounds is a bug.
3. Every `tool_call_started` has a matching `tool_call_finished` with the same `callId` — including on timeout and open breaker.
4. `error` after some `token` events is legal and expected: a post-check refusal (stage 5) can arrive after partial text. Clients must be able to retract streamed text; the widget shows the refusal and discards the partial answer.
5. Cost and token counts are recorded per call against tenant, agent and conversation ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 5) whether or not the client is shown them.
6. `shj3-web` filters on the citizen path: internal ids (`policyId`, `serverId`, `passageId`), cost fields, prompt text and raw tool arguments never reach the browser. The backoffice sandbox (B3 step 9) and B1's transcript view receive the unfiltered stream, gated on `agents.manage`.

```
id: 1
event: turn_started
data: {"turnId":"trn_01JBQ8","startedAt":"2026-09-08T09:12:33.481Z"}

id: 2
event: guardrail
data: {"stage":"pre","decision":"pass","policyId":"prompt_injection_filter"}

id: 3
event: route
data: {"agentId":"agt_billing","agentName":"SEWA & Utilities Billing Agent","confidence":0.94,"mode":"sequential","alternatives":[{"agentId":"agt_faq","confidence":0.21}]}

id: 4
event: tool_call_started
data: {"callId":"tc_1","toolName":"get_bill_status","source":"mcp","serverId":"mcp_gateway","args":{"provider":"SEWA","account_number":"••••4821"}}

id: 5
event: tool_call_finished
data: {"callId":"tc_1","toolName":"get_bill_status","outcome":"ok","durationMs":238,"retries":0}

id: 6
event: retrieval
data: {"queryId":"rq_7","passageCount":8,"topScore":0.91,"degraded":[],"graphHops":2}

id: 7
event: citation
data: {"sourceId":"src_sewa_tariff","sourceName":"SEWA tariff schedule","passageId":"p_211","score":0.91,"freshness":"2026-09-08T07:10:00.000Z","entityPath":["Service(Pay utilities bill)","Provider(SEWA)","Fee"]}

id: 8
event: token
data: {"text":"Could you please provide me with your SEWA "}

id: 9
event: token
data: {"text":"account number?"}

id: 10
event: slot_update
data: {"slot":"account_number","state":"awaiting"}

id: 11
event: trace_update
data: {"traceId":"4bf92f3577b34da6a3ce929d0e0e4736","hops":2,"toolCalls":1,"tokensTotal":1841,"costAed":0.0121,"elapsedMs":2140}

id: 12
event: done
data: { … turn envelope, §5.3 … }
```

Refusal mid-stream, after partial text — the unhappy path that matters most:

```
id: 8
event: token
data: {"text":"The residential tariff is "}

id: 9
event: guardrail
data: {"stage":"post","decision":"block","policyId":"grounding_threshold","reason":"grounding_below_threshold"}

id: 10
event: error
data: {"type":"https://api.shj3.gov.ae/problems/guardrail.blocked_output","title":"Answer withheld","status":200,"code":"guardrail.blocked_output","detail":"I'm not confident enough in that answer to give it. I can connect you to a colleague who can help.","traceId":"4bf92f…","requestId":"req_01JBQ8","timestamp":"2026-09-08T09:12:36.902Z","meta":{"grounding":0.41,"threshold":0.75,"offerHandover":true}}
```

`"status": 200` is not a mistake — the HTTP response was already `200` when the stream opened, so the problem document carries the semantic outcome. `threshold: 0.75` is the SEWA billing agent's per-agent override, not the global 0.60 (B12 tab 2), and `meta.grounding` explains *why* — the same principle B13 tab 3 applies to the publish gate.

### 5.3 The turn envelope

Emitted as `done`, and returned as the whole body when `Accept: application/json`. This is the object A2's diagnostics rail renders and the object `shj3-web` persists into the transcript.

```json
{
  "turnId": "trn_01JBQ8",
  "conversationId": "conv_01JBQ7",
  "status": "completed",
  "message": {
    "role": "assistant",
    "content": "Could you please provide me with your SEWA account number?",
    "suggestions": [{ "id": "qa_sewa_help", "label": "Where do I find my account number?" }],
    "renderedAs": "text"
  },
  "flowState": { "flowId": "flw_pay_utilities", "nodeId": "nd_ask_account",
                 "slots": { "provider": "SEWA" }, "awaitingSlot": "account_number" },
  "trace": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "mode": "sequential",
    "route": { "agentId": "agt_billing", "agentName": "SEWA & Utilities Billing Agent",
               "confidence": 0.94, "alternatives": [{ "agentId": "agt_faq", "confidence": 0.21 }] },
    "hops": [
      { "hop": 1, "agentId": "agt_billing", "role": "primary",
        "toolCalls": [{ "callId": "tc_1", "toolName": "get_bill_status", "source": "mcp",
                        "args": { "provider": "SEWA", "account_number": "••••4821" },
                        "outcome": "ok", "durationMs": 238, "retries": 0 }],
        "tokensIn": 1204, "tokensOut": 61, "model": "anthropic/claude-sonnet-5", "costAed": 0.0098 },
      { "hop": 2, "agentId": "agt_knowledge", "role": "secondary",
        "retrieval": { "queryId": "rq_7", "graphWeight": 0.6, "vectorWeight": 0.4,
                       "topK": 8, "reranked": true, "degraded": [] },
        "tokensIn": 512, "tokensOut": 64, "model": "anthropic/claude-sonnet-5", "costAed": 0.0023 }
    ],
    "guardrails": [
      { "stage": "pre",  "policyId": "prompt_injection_filter", "decision": "pass" },
      { "stage": "pre",  "policyId": "scope_restriction",       "decision": "pass" },
      { "stage": "post", "policyId": "grounding_threshold",     "decision": "pass",
        "grounding": 0.88, "threshold": 0.75, "thresholdSource": "agent_override" },
      { "stage": "post", "policyId": "mask_pii", "decision": "applied", "fieldsMasked": ["account_number"] }
    ],
    "merge": { "policy": "ordered_concat", "overlapsResolved": 0 },
    "budget": { "maxHops": 6, "hopsUsed": 2, "maxCostAed": 0.35, "costAed": 0.0121, "elapsedMs": 2140 },
    "degraded": []
  },
  "sources": [
    { "sourceId": "src_sewa_tariff", "sourceName": "SEWA tariff schedule", "sourceType": "document",
      "owner": "SEWA", "passageId": "p_211", "score": 0.91,
      "updatedAt": "2026-09-08T07:10:00.000Z", "freshnessLabel": "2 hours ago",
      "entityPath": ["Service(Pay utilities bill)", "Provider(SEWA)", "Fee"],
      "conflicted": false }
  ],
  "usage": { "tokensIn": 1716, "tokensOut": 125, "costAed": 0.0121, "modelCalls": 2, "toolCalls": 1 },
  "createdAt": "2026-09-08T09:12:33.481Z",
  "completedAt": "2026-09-08T09:12:35.621Z"
}
```

`status` ∈ `completed` | `refused` | `blocked` | `escalated` | `failed` | `cancelled`. `trace.degraded` carries tokens like `reranker_unavailable`, `primary_model_failed`, `circuit_open:sewa_bill_api` — the same facts B14 tab 3 aggregates and B5 tab 4 configures. `sources[].conflicted` is true when a cited entity has an unresolved conflict (B6 tab 4); that flag is the mechanism by which an unresolved conflict lowers grounding confidence.

Two more turn-scoped endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/conversations/{id}/turns/{turnId}/stream` | Re-attach to an in-flight turn, replaying from `Last-Event-ID`. Buffered events are kept in Redis for 5 minutes. |
| `POST` | `/v1/conversations/{id}/turns/{turnId}/cancel` | Cancel an in-flight turn (citizen closed the widget, agent took over). Stops model and tool work, persists the turn as `cancelled` with its partial trace. Idempotent; on a terminal turn → `409`. |

### 5.4 Retrieval

Powers B6 tab 3's retrieval playground and every grounded turn.

```http
POST /v1/retrieval/query
{
  "query": "SEWA residential tariff rate",
  "locale": "en",
  "config": { "hybridWeighting": { "graph": 0.6, "vector": 0.4 }, "topK": 8, "reranker": true,
              "collectionIds": ["col_sewa_tariff", "col_utilities_directory"] },
  "includeSubgraph": true,
  "explain": true
}
```

`config` is optional. Omitted, the tenant's saved retrieval config (B6 tab 3) applies. Supplied, it **overrides for this call only and is not persisted** — which is exactly what the playground needs: try 80/20 and top-K 3 without changing production retrieval. `graph + vector` must sum to 1.0 ± 0.001 (`422 validation.failed`), `topK` is 1–50, `query` ≤ 1,000 characters (`422 retrieval.query_too_long`).

```json
{
  "queryId": "rq_7",
  "passages": [
    { "rank": 1, "passageId": "p_211", "sourceId": "src_sewa_tariff",
      "sourceName": "SEWA tariff schedule", "section": "1. Residential",
      "text": "Residential consumption is billed at AED 0.23 per kWh…",
      "score": 0.91, "scores": { "graph": 0.94, "vector": 0.86, "rerank": 0.91 },
      "updatedAt": "2026-09-08T07:10:00.000Z", "conflicted": true, "conflictId": "cfl_tariff" },
    { "rank": 2, "passageId": "p_88", "sourceId": "src_utilities_directory",
      "sourceName": "Utilities providers directory", "section": "Providers",
      "text": "SEWA, Etisalat and du are the eligible utility providers…",
      "score": 0.84, "scores": { "graph": 0.81, "vector": 0.88, "rerank": 0.84 },
      "updatedAt": "2026-09-07T09:00:00.000Z", "conflicted": false },
    { "rank": 3, "passageId": "p_214", "sourceId": "src_sewa_tariff",
      "sourceName": "SEWA tariff schedule (section 2)", "section": "2. Thresholds",
      "text": "Payment thresholds apply above 2,000 kWh…",
      "score": 0.77, "scores": { "graph": 0.72, "vector": 0.79, "rerank": 0.77 },
      "updatedAt": "2026-09-08T07:10:00.000Z", "conflicted": false }
  ],
  "subgraph": {
    "nodes": [
      { "id": "n_svc_pay_utilities", "type": "Service",  "label": "Pay utilities bill",  "matched": true },
      { "id": "n_prv_sewa",          "type": "Provider", "label": "SEWA",                "matched": true },
      { "id": "n_fee_residential",   "type": "Fee",      "label": "Residential tariff",  "matched": true }
    ],
    "edges": [
      { "from": "n_svc_pay_utilities", "to": "n_prv_sewa",        "type": "HAS_PROVIDER" },
      { "from": "n_prv_sewa",          "to": "n_fee_residential", "type": "HAS_FEE" }
    ],
    "paths": [["Service(Pay utilities bill)", "Provider(SEWA)", "Fee(Residential tariff)"]]
  },
  "explain": {
    "graphCandidates": 14, "vectorCandidates": 40, "fusedCandidates": 46,
    "rerankedFrom": 46, "embeddingModel": "text-embedding-3-large", "embeddingDim": 3072,
    "rerankModel": "rerank-v3.5", "graphMs": 61, "vectorMs": 44, "rerankMs": 128, "totalMs": 244
  },
  "grounding": 0.88,
  "degraded": []
}
```

Mechanics that are contractual, not implementation detail:

1. **60/40 hybrid fusion.** Graph traversal and vector search run in parallel, each returning candidates with normalised scores; fusion is weighted reciprocal-rank using the configured weights. `scores` exposes the per-channel contributions, so the playground can *explain* a ranking rather than assert it.
2. **The reranker sees the fused candidate set, not top-K.** With the toggle on, fusion returns up to `max(topK×5, 40)` candidates, Cohere `rerank-v3.5` reorders them, and `topK` is taken afterwards. Reranking an already-truncated top-K would be pointless. With the toggle off, `scores.rerank` is null and `topK` comes straight from fusion.
3. **Reranking degrades, it does not fail** ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 6): Cohere unavailable → unreranked hybrid results, `degraded: ["reranker_unavailable"]`, `200`.
4. **Embedding-model mismatch is a hard failure, not a silent one.** Each Qdrant collection records the model and dimension that built it. A query embedded with a different model → `409 knowledge.embedding_model_mismatch`, naming both. Mixing 3072-dim `text-embedding-3-large` vectors with `multilingual-e5` vectors silently destroys retrieval quality, and silent quality loss is the worst failure available here ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 3).
5. `grounding` is the aggregate the post-check guardrail compares against the threshold. Passages marked `conflicted` are penalised — the mechanical link from B6 tab 4 to B12.

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/retrieval/query` | Hybrid retrieval; ranked passages + matched subgraph | B6 tab 3 playground |
| `POST` | `/v1/retrieval/embeddings` | Embed text for internal use (evaluation similarity scoring). Not a general-purpose embedding proxy: capped at 64 inputs, rate-limited. | B13 |
| `POST` | `/v1/retrieval/chunking/preview` | Preview chunk boundaries for a candidate chunk size/overlap before committing a re-index. **[ASSUMPTION]** — B6 tab 3 makes chunk size and overlap editable; changing them blind is a multi-minute mistake, so a preview earns its place. | B6 tab 3 |

### 5.5 Knowledge

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/knowledge/sources` | Register and ingest a source. `multipart` for a document, JSON for URL crawler / database / SharePoint / API feed. `202` + job. | B6 tab 1 `+ Add source` |
| `GET` | `/v1/knowledge/sources` | Sources with indexing percentage and last-crawled time | B6 tab 1 table |
| `GET` | `/v1/knowledge/sources/{id}` | One source, with chunk and vector counts | B6 tab 1 |
| `DELETE` | `/v1/knowledge/sources/{id}` | Remove the source, its chunks, its vectors and its graph contributions. `202` — the cascade spans Neo4j and Qdrant and is not instantaneous. Nodes contributed by other sources survive; nodes left with no contributing source are removed. | B6 tab 1 `Remove` |
| `POST` | `/v1/knowledge/sources/{id}/reindex` | Re-crawl and re-index one source. `202` + job. | B6 tab 1 `Re-crawl now` |
| `POST` | `/v1/knowledge/reindex` | Re-index **all** sources. `Idempotency-Key` required. Already running → `409 knowledge.reindex_in_progress` carrying the running job, not a second job. | B6 tab 3 `Re-index all sources now` |
| `GET` | `/v1/jobs` | Job history, cursor-paginated, filterable by `type` and `status` | B6 tab 3 re-index job list |
| `GET` | `/v1/jobs/{jobId}` | Job status (§5.7) | B6 tab 3 |
| `POST` | `/v1/jobs/{jobId}/cancel` | Cancel a queued or running job. Idempotent; terminal → `409`. **[ASSUMPTION]** | B6 tab 3 |
| `GET` | `/v1/knowledge/graph` | Nodes and edges for the explorer: `?rootId=&depth=2&types=Service,Provider&limit=250`. Hard cap 500 nodes; over it, `meta.truncated: true` and a required narrowing filter — an unbounded graph read is a self-inflicted outage. | B6 tab 2 explorer |
| `GET` | `/v1/knowledge/graph/entities?q=…` | Entity search; drives the live dimming of non-matching nodes | B6 tab 2 `Search entities` |
| `GET` | `/v1/knowledge/graph/nodes/{id}` | One node: properties, neighbours, contributing sources, cited-in count | B6 tab 2 node click |
| `POST` | `/v1/knowledge/graph/nodes` | Add a node: `{type, label, parentId, properties}`. Creates the node **and its edge to the parent** in one transaction, so the graph is never left holding an orphan. Returns the node with its edge, immediately queryable — which is why B6 tab 2's new entity is instantly clickable. | B6 tab 2 `+ Add node` |
| `PATCH` | `/v1/knowledge/graph/nodes/{id}` | Edit label and properties. Type is immutable (`422 value.immutable`) — retyping a node invalidates every edge constraint on it. **[ASSUMPTION]** | B6 tab 2 |
| `DELETE` | `/v1/knowledge/graph/nodes/{id}` | Delete a node and its edges. `409` if it is the last grounding for a published agent's bound collection. **[ASSUMPTION]** | B6 tab 2 |
| `GET` | `/v1/knowledge/duplicates` | Detected duplicate pairs with similarity and evidence — `SEWA ↔ Sharjah Electricity & Water Authority`, `du ↔ du Telecom` | B6 tab 2 duplicate detection |
| `POST` | `/v1/knowledge/duplicates/{id}/merge` | Merge with `{survivorId}`. Re-points every edge onto the survivor, unions properties, records an alias so a later ingest does not recreate the duplicate, and keeps a reversible merge record. Not a detected pair, or same node → `422 knowledge.merge_invalid`. | B6 tab 2 `Merge` |
| `POST` | `/v1/knowledge/duplicates/{id}/ignore` | Suppress the pair; not re-offered unless similarity changes materially | B6 tab 2 `Ignore` |
| `GET` | `/v1/knowledge/conflicts` | Conflicting values per entity, both sides with source, value and freshness | B6 tab 4 |
| `POST` | `/v1/knowledge/conflicts/{id}/resolve` | `{authoritativeSourceId}`. Marks one side authoritative, re-scores affected passages, clears `conflicted`. Under policy *Always ask an admin*, an automated resolution is refused with `409 knowledge.conflict_policy_requires_admin`. | B6 tab 4 `Make authoritative` |
| `GET` \| `PUT` | `/v1/knowledge/retrieval-config` | Chunk size, overlap, embedding model, hybrid weighting, top-K, reranker. `If-Match` required. **Changing the embedding model returns `202` with a mandatory full re-index job** and `meta.warning` — never a saved preference that silently mismatches the index ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 3). | B6 tab 3 |
| `GET` \| `PUT` | `/v1/knowledge/conflict-policy` | `prefer_most_recent` \| `prefer_owning_entity` \| `always_ask_admin` | B6 tab 4 default policy |

### 5.6 Tools

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/tools/mcp/servers/{id}/connect` | **Connect and discover.** Opens the MCP session with the configured auth (OAuth2 client-credentials or mTLS), completes the handshake, calls `tools/list`, persists the discovered descriptors with their JSON schemas, returns them. Failure → `502 tools.mcp_connect_failed` with `meta.reason` from a closed set (`dns`, `tls`, `auth`, `timeout`, `protocol`) — never the driver's exception text. Connected but empty → `502 tools.mcp_discovery_empty`. | B3 step 4B `Connect & discover tools`; B5 tab 2 |
| `GET` | `/v1/tools/mcp/servers/{id}/tools` | Discovered tools with schemas and last-discovery time | B3 step 4B bindable pills |
| `POST` | `/v1/tools/mcp/servers/{id}/disconnect` | Close the session, keep the descriptors, mark `not_connected`. **[ASSUMPTION]** | B5 tab 2 |
| `POST` | `/v1/tools/connectors/{id}/test` | **Test connection.** Issues the configured request with a synthetic argument set; returns status, latency and a **redacted** sample response body. Secrets and auth headers are never echoed. An upstream failure returns `200` with `{ok:false, reason}` — a failed test is a successful test *run*, not a `5xx`. | B3 step 4C `Test connection`; B5 tab 3 |
| `POST` | `/v1/tools/invocations` | Invoke one tool: `{agentId, toolName, source, args, conversationId?, timeoutMs?}`. Enforces, in this order: **binding** (unbound → `403 tools.not_bound`, the B3 step 4 tool-permission boundary), breaker state (open → `503 upstream.circuit_open` plus the fallback descriptor), argument validation against the discovered schema, then the call. Used by the runtime and by the backoffice test harness. | B3 step 4 rule "Registered ≠ callable"; B5 |
| `GET` | `/v1/tools/breakers` | Live breaker state per service, read from Redis so it is consistent across replicas | B5 tab 4; B14 tab 3 |
| `POST` | `/v1/tools/breakers/{service}/trip` | Trip manually (test). `{reason}` required. | B5 tab 4 `Trip manually` |
| `POST` | `/v1/tools/breakers/{service}/reset` | Close the breaker, clear the failure window | B5 tab 4 `Reset breaker` |

Breaker state is Redis-resident and shared: a breaker tripped on one pod is tripped on all ([`architecture.md`](./architecture.md) §10). The seeded SEWA bill API breaker is **Open**, which is the same incident B14 tab 3 reports as Degraded — one fact, two screens, one source.

### 5.7 Evaluation, sandbox, and the async job pattern

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/evaluation/turns` | **Corrected 2026-09-10 (B-9) — supersedes the `POST /v1/evaluation/runs` + `GET /v1/evaluation/runs/{runId}` job-style pair this row and the two below it originally documented.** Runs exactly one turn, pinned to a specific `agentVersionId` (never resolved from `Agent.currentVersionId`), against a `Conversation` row the caller (`apps/web`, which holds the write grant) already created. Synchronous request/response — no job, no `Idempotency-Key` — because `shj3_ai_ro` has no write grant on `RegressionRuns`/`RegressionCaseResults`/`GoldenSets`/`Conversations`, so the batch orchestration (one call per golden case, persisting `RegressionRun`/`RegressionCaseResult` rows) lives entirely on `apps/web`'s `RunGoldenSetNow`/`RunAllSuites` use cases, not here. Returns `{status, messageText, wasRefused, groundingConfidence, toolCalls[]}` — the real per-turn signal a golden case scores against (`wasRefused` for a `mustRefuse` case; `toolCalls` against `expectedToolCallsJson`; `groundingConfidence` as the case's groundedness score directly). | B13 tab 1 `Run now`; tab 2 `Run all suites` |
| `POST` | `/v1/evaluation/score-similarity` | Pure computation, no table touched: embeds `{actual, expected}` via the same embedder the retrieval pipeline uses and returns their cosine similarity — the real accuracy-scoring signal for a non-`mustRefuse` case. Synchronous, no job. | B13 tab 1/2 |
| `POST` | `/v1/sandbox/turns` | Execute a turn against an **unpublished draft** agent config supplied inline — no conversation, no persistence beyond the trace, full diagnostics. This is what makes B3 step 9's sandbox a real exchange rather than a mock. | B3 step 9 |
| `POST` | `/v1/guardrails/evaluate` | Dry-run pre- and post-check against supplied text and a candidate policy set, returning each decision. Lets B12 show the effect of a threshold change before saving, and lets the red-team set be scored without a full turn. **[ASSUMPTION]** | B12; B13 red-team set |
| `POST` | `/v1/orchestration/trace-preview` | **Built 2026-09-15 — supersedes this row's own prior `[ASSUMPTION]`.** Body: `{primaryAgentId, content, locale}` — no execution-mode parameter, because the preview always runs the real, currently-*saved* `RouterConfigs` singleton (`ConfigReader` is the one real port here), not a mode chosen ad hoc for the call. Runs the real `ProcessTurn` pipeline end to end, but never persists a `Conversation`/`ConversationTurn`/`OrchestrationTrace` row (an in-memory sandbox store, reused from `/v1/sandbox/turns`) and never spends real money regardless of whether the tenant has a real model API key configured (an unconditional `DeterministicChatModel`, never the environment-conditional real one — the one deliberate difference from `/v1/sandbox/turns`, which does allow real spend as an Agent Designer's own opt-in). Returns the same `TurnEnvelopeOut` shape `/v1/conversations/{id}/turns` and `/v1/sandbox/turns` already return. `404 orchestration.primary_agent_not_found` if `primaryAgentId` does not resolve to a real agent. No permission check on this router itself — see the `orchestration` table (§6.4) for where that lives on the `apps/web` side. | B4 "Test a prompt" |

**The async job pattern**, used by re-index (§5.5), evaluation runs, source ingest and campaign sends:

1. `POST` returns `202 Accepted`, `Location: /v1/jobs/{jobId}`, and the job resource.
2. The job runs on a `shj3-ai` replica started with the worker entrypoint — a replica, not a third deployable ([ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md) constraint 1).
3. `GET /v1/jobs/{jobId}` polls. `retryAfterSeconds` on the body and `Retry-After` on the response tell the client how long to wait; the backoffice polls at that interval rather than a hardcoded one.
4. Status is `queued` → `running` → `completed` | `failed` | `cancelled`, with `progress` (`{done, total, unit}`), `startedAt`, `finishedAt`, `error` (a problem document, on failure) and `result` (on success).
5. **Jobs are idempotent per scope.** One re-index per source, one evaluation run per (set, agent version). A duplicate submit returns the in-flight job with `200` and `Idempotency-Replayed: true`, never a second job — B6 tab 3's "Re-index all" double-click must not double the load.
6. Terminal jobs are retained 30 days, which is what makes B6 tab 3's re-index history and B13 tab 2's regression history real records rather than a live-only view.
7. Cancellation is cooperative: the worker checks a Redis flag between units, so a cancelled re-index leaves the index consistent — the last completed source committed, the remainder untouched — rather than half-written.

```json
{
  "jobId": "job_01JBQ9",
  "type": "knowledge.reindex_all",
  "status": "running",
  "progress": { "done": 2, "total": 4, "unit": "sources" },
  "startedAt": "2026-09-08T09:20:00.000Z",
  "finishedAt": null,
  "result": null,
  "error": null,
  "retryAfterSeconds": 5
}
```

### 5.8 Health

Three endpoints with three distinct jobs. Conflating liveness and readiness is how a slow dependency becomes a restart loop.

| Method | Path | Probe | Semantics |
|---|---|---|---|
| `GET` | `/v1/health/live` | `livenessProbe` | Process alive, event loop responsive. **Checks no dependency.** `200` unless the process is wedged — so a Neo4j outage never causes a restart storm. |
| `GET` | `/v1/health/ready` | `readinessProbe` | `200` only if this pod can serve a turn: SQL Server reachable, Redis reachable, chat-model adapter configured with its credential present. Neo4j and Qdrant **degrade** rather than un-ready the pod: a conversation without retrieval is worse than good but better than no conversation. `503 service.draining` during shutdown, so the pod leaves the endpoint list before it stops accepting. |
| `GET` | `/v1/health/dependencies` | — | Per-dependency status, p95 latency, error rate over a 5-minute window, breaker state. Feeds B14 tab 3. Never exposed publicly — `/api/public/v1/health` is shallow by design (§4.2). |

```json
{
  "status": "degraded",
  "checkedAt": "2026-09-08T09:12:33.481Z",
  "dependencies": [
    { "id": "mcp_sharjah_services", "name": "Sharjah Services Gateway (MCP)", "kind": "mcp",
      "status": "healthy",  "p95LatencyMs": 240,  "errorRatePct": 0.2, "breaker": "closed" },
    { "id": "connector_sewa_bill",  "name": "SEWA bill API", "kind": "connector",
      "status": "degraded", "p95LatencyMs": 1840, "errorRatePct": 6.1, "breaker": "open",
      "remediation": { "screen": "B5.4", "path": "/backoffice/tools?tab=resilience" } },
    { "id": "retrieval", "name": "Graph RAG retrieval", "kind": "internal",
      "status": "healthy",  "p95LatencyMs": 310,  "errorRatePct": 0.0, "breaker": null },
    { "id": "bsp_whatsapp", "name": "WhatsApp BSP", "kind": "channel",
      "status": "healthy",  "p95LatencyMs": 190,  "errorRatePct": 0.4, "breaker": "closed" }
  ]
}
```

`status` is the worst dependency status. `remediation` is what lets B14 tab 3's summary strip point at B5 tab 4 — the link is data, not a hardcoded string in the UI.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/openapi.json` | The contract; source for the generated `shj3-web` client (§1.2) |

### 5.9 Flow authoring — AI sidebar

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/flows/edit-proposals` | The Flow Designer's "AI sidebar": a staff user's plain-language instruction plus the flow's current node/edge snapshot (sent by the caller — `shj3-ai` has neither write access to `FlowNodes`/`FlowEdges` nor an authoring-shaped read of them, §9.13) in, one structured `FlowEditPlan` out. **Computes and returns a plan; writes nothing.** A human reviews and applies each operation through the existing flow CRUD backoffice endpoints (§6.7), never through this one. | B7 AI sidebar |

Request:

```json
{
  "instruction": "Add a question asking for the bill amount",
  "conversationHistory": [
    { "role": "user", "text": "Add a question node" },
    { "role": "assistant", "text": "Added a Question node asking for the amount." }
  ],
  "nodes": [ { "id": "node_01J...", "type": "Message", "title": "Greeting", "messageText": "Welcome!" } ],
  "edges": [],
  "model": "anthropic/claude-sonnet-5",
  "fallbackModel": null
}
```

`model`/`fallbackModel` are optional. When present, they come from the caller's `FlowAssistantConfig` (§6.7's AI settings entry) and override this service's own `SHJ3_FLOW_EDIT_MODEL`/`SHJ3_FLOW_EDIT_FALLBACK_MODEL` environment defaults for this one request; omitted, the environment default applies exactly as before this override existed.

Response — one flattened operation shape for all 8 kinds (`CreateNode`, `UpdateNode`, `DeleteNode`, `CreateEdge`, `UpdateEdge`, `DeleteEdge`, `SetEntryNode`, `SetEscapeNode`); only the fields a given `kind` actually uses are non-null:

```json
{
  "planSummary": "Add a follow-up question",
  "operations": [
    {
      "kind": "CreateNode", "summary": "Ask for the bill amount",
      "placeholderId": "amount", "nodeType": "Question", "title": "Ask amount",
      "slotName": "amount", "optionSourceKind": "Static", "staticOptionsJson": "[\"Yes\",\"No\"]"
    }
  ],
  "warnings": [],
  "usedFallbackModel": false
}
```

### 5.10 Agent authoring — "Create with AI"

| Method | Path | Purpose | Wireframe |
|---|---|---|---|
| `POST` | `/v1/agents/creation-proposals` | The registry's "Create with AI" entry point (§6.3): a staff user's business-language description plus the tenant's real, existing catalogs (skills, MCP tools, API connectors, unlocked guardrail policy keys, whether a knowledge collection exists) in, one structured `AgentCreationPlan` out. **Computes and returns a plan; writes nothing.** A human reviews it, and `apps/web`'s `POST /agents/from-proposal` (§6.3) applies the accepted subset through the same real per-field endpoints a manual wizard edit already uses. | B2 `Create with AI` |

This plan's only flow-shaped output is `flowInstruction` — one plain-language sentence, not a node/edge graph. Flow generation is deliberately left to §5.9's own, already-separate call rather than duplicated here: one LLM response spanning two very different, independently-fragile schemas (an agent's scalar/catalog-grounded fields AND a flow's node/edge graph) is a real correctness risk, not a theoretical one. `apps/web`'s apply step feeds `flowInstruction`, unmodified, into §5.9 as a second, separate request once the plan is approved.

Request:

```json
{
  "businessDescription": "An agent that helps citizens check their business license renewal status and hands over to a human if the license has expired.",
  "skills": [ { "id": "skill_01J...", "name": "Check License", "description": null } ],
  "mcpTools": [ { "id": "mcptool_01J...", "name": "Lookup", "serverName": "Licensing" } ],
  "apiConnectors": [ { "id": "connector_01J...", "name": "License API" } ],
  "guardrailPolicies": [
    { "policyKey": "grounding_threshold", "title": "Grounding threshold", "detail": "…" }
  ],
  "knowledgeCollectionExists": true,
  "model": "anthropic/claude-sonnet-5",
  "fallbackModel": null
}
```

`guardrailPolicies` never includes a locked policy (`mask_pii_in_transcripts`) — the caller filters those out before sending, the same trust boundary §5.9's tool-binding-id catalog already established. `model`/`fallbackModel` resolve from the same tenant `FlowAssistantConfig` §5.9 uses — there is no second, agent-creation-specific tenant setting.

Response:

```json
{
  "planSummary": "A licensing status assistant",
  "name": "License Status Helper",
  "description": "Helps citizens check business license renewal status.",
  "systemPrompt": "…",
  "tone": "Concise",
  "primaryModel": "anthropic/claude-sonnet-5",
  "fallbackModel": null,
  "temperature": 0.4,
  "channelKeys": ["WebWidget", "WhatsApp"],
  "guardrailOverrides": [
    { "policyKey": "grounding_threshold", "mode": "Value", "valueJson": "0.8", "reason": "…" }
  ],
  "toolBindings": [
    { "targetKind": "Skill", "targetId": "skill_01J...", "requiredAssurance": "Verified" }
  ],
  "enableKnowledge": true,
  "flowInstruction": "Greet, collect the license number, check its status via Check License, hand over to a human if expired.",
  "warnings": [],
  "usedFallbackModel": false
}
```

Any guardrail override naming an unknown or locked policy key, or any tool binding naming an id absent from the matching real catalog, is dropped individually with a warning — the same "never invent, never crash" contract §5.9's `parse_flow_edit_plan` already established, applied here by `parse_agent_creation_plan`.

**Internal API: 49 endpoints.**

---

## 6. Backoffice API

`shj3-web`, prefix `/api/backoffice`. Unversioned (§1.2). Every endpoint requires a staff session and declares exactly one permission (or an AND-set) from B9 tab 3's 7×8 matrix. Deny by default (§3.4).

Permission keys, once, for reference:

| Key | B9 row | Roles holding it |
|---|---|---|
| `dashboard.view` | View dashboard | Super Admin, Entity Admin, Agent Designer, Knowledge Mgr, Reviewer, Analyst |
| `agents.manage` | Manage agents | Super Admin, Entity Admin, Agent Designer |
| `agents.publish` | Publish agents | Super Admin, Entity Admin |
| `knowledge.manage` | Manage knowledge | Super Admin, Entity Admin, Knowledge Mgr |
| `routing.manage` | Manage routing rules | Super Admin, Entity Admin |
| `escalations.handle` | Handle escalations | Super Admin, Live Agent |
| `users.manage` | Manage users & teams | Super Admin |
| `analytics.view` | View analytics | Super Admin, Entity Admin, Reviewer, Analyst |

Rows marked *(proxy)* are `shj3-web` route handlers that forward to the internal API (§5), because `shj3-web` holds no Neo4j or Qdrant client ([ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md) constraint 2). A proxy row still performs its own authentication, permission check, tenant resolution and audit write; it forwards only after all four.

### 6.1 `iam` — B9 Users, teams & roles

Auth endpoints are in §3.2 and are not repeated here.

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/iam/users` | `users.manage` | List users with team, role and status. Cursor-paginated; `?status=&teamId=&role=&q=` | B9 tab 1 table |
| `POST` | `/iam/users` | `users.manage` | Invite a user. Enters as `Invited`; issues a single-use invite token that forces password creation **and** TOTP enrolment for privileged roles ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 4). Duplicate email → `409 user.email_taken`. | B9 tab 1 `+ Invite user` |
| `GET` | `/iam/users/{id}` | `users.manage` | One user, with effective permissions computed from roles | B9 tab 1 |
| `PATCH` | `/iam/users/{id}` | `users.manage` | Edit name, email, teams, roles. Changing roles does **not** revoke the session — permissions are re-read per request (§3.6). Removing the last `Super Admin` role → `422 user.last_super_admin`. | B9 tab 1 `Edit` — name, email, team pills, role pills |
| `POST` | `/iam/users/{id}/suspend` | `users.manage` | Suspend. **Deletes every session for that user in the same operation** (§3.6). Already suspended → `409 user.already_suspended`. Self-suspension and last-Super-Admin suspension → `422 user.last_super_admin`. | B9 tab 1 `Suspend` |
| `POST` | `/iam/users/{id}/reactivate` | `users.manage` | Back to `Active`. Sessions are **not** restored; the user signs in again. | B9 tab 1 `Reactivate` |
| `DELETE` | `/iam/users/{id}` | `users.manage` | Remove. Soft-delete: the audit log (B14 tab 2) must keep resolving the actor's name years later, so the row is tombstoned, not erased. Sessions deleted. `204`. | B9 tab 1 `Remove` |
| `POST` | `/iam/users/{id}/invitations` | `users.manage` | Re-send the invite; invalidates the previous token | B9 tab 1 **[ASSUMPTION]** — `Invited` state implies a resend path |
| `GET` | `/iam/teams` | `users.manage` | Teams with entity scope and **live-derived** member chips | B9 tab 2 table |
| `POST` | `/iam/teams` | `users.manage` | `{name, entityScope}` where scope is a tenant entity or `all` (the `Platform` team) | B9 tab 2 `+ Add team` |
| `PATCH` | `/iam/teams/{id}` | `users.manage` | Rename, change entity scope. Narrowing scope re-evaluates every member's reachable agents and knowledge sources, so the response includes `meta.affectedUsers`. | B9 tab 2 **[ASSUMPTION]** |
| `DELETE` | `/iam/teams/{id}` | `users.manage` | Non-empty → `409 team.has_members`, listing them. Reassign first; a cascade that silently orphans users' entity scope is worse than a refusal. | B9 tab 2 **[ASSUMPTION]** |
| `GET` | `/iam/teams/{id}/members` | `users.manage` | Membership, derived from the Users tab rather than stored twice — which is why reassigning a user's team updates both tabs (B9 cross-wiring) | B9 tab 1 → tab 2 |
| `GET` | `/iam/roles` | `users.manage` | 7 seeded roles + custom roles, each with its permission set — the matrix, as data | B9 tab 3 matrix |
| `POST` | `/iam/roles` | `users.manage` | Add a custom role. Created with **all permissions off**, matching the wireframe. Name clash → `409 role.name_taken`. | B9 tab 3 `+ Add custom role` |
| `PUT` | `/iam/roles/{id}/permissions` | `users.manage` | Replace a role's permission set. `If-Match` **required** (§1.9) — two admins editing the matrix concurrently must not lose a cell. This is one `PUT` of the whole set, not per-cell `PATCH`es: the UI toggles cells locally and saves the row, so a half-applied matrix is impossible. Removing `users.manage` from the last role that grants it → `422 user.last_super_admin`. | B9 tab 3 every cell toggle |
| `DELETE` | `/iam/roles/{id}` | `users.manage` | Delete a custom role. Held by an active user → `409 role.in_use`. Seeded roles are undeletable → `403 authz.role_immutable`. | B9 tab 3 **[ASSUMPTION]** |
| `GET` | `/iam/permissions` | `users.manage` | The 8 permission definitions with descriptions — the matrix's column headers as data, so the UI never hardcodes them | B9 tab 3 |
| `GET` | `/iam/security-policy` | `security.manage` | Session TTL (idle/absolute) and lockout policy (failures-before-lock, lockout duration, backoff ceiling) for this tenant. Seeded to the hardcoded product defaults on first read — a tenant that never opens this screen sees no behaviour change. | B9 Security tab — policy form |
| `PUT` | `/iam/security-policy` | `security.manage` | Update the policy. Validated against the same numeric ranges the DB's own `CK_SecurityPolicies_ranges` enforces; out-of-range → `422 security.value_out_of_range`. Takes effect on the **next request** — every session's TTL and every subsequent lockout check re-read this row, not just new sign-ins. | B9 Security tab `Save` |
| `GET` | `/iam/users/totp-status` | `security.manage` | Whether each of this tenant's staff users currently has a TOTP secret enrolled — the Security tab's per-row status column. | B9 Security tab TOTP table |
| `POST` | `/iam/users/{id}/totp/reset` | `security.manage` | Clears one user's TOTP enrolment (lost device, compromised secret). Does **not** disable the second-factor requirement itself ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 4 stays in force) — the user is forced through enrolment again on their next sign-in that needs one. | B9 Security tab `Reset` |

**22 endpoints.**

Every write in this module writes an audit entry in the same transaction (§12 invariant 3) — B14 tab 2's seeded *"Granted Entity Admin role to Lina Haddad"* is exactly this.

### 6.2 `analytics` — B1 Command centre

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/metrics/overview?range=today\|last_7d\|last_30d` | `dashboard.view` | The four KPIs: conversations, containment rate, deflection rate, tool error rate. Each with the prior-period delta. | B1 tab 1 KPI grid; date-range toggle |
| `GET` | `/metrics/channel-split?range=…` | `dashboard.view` | Seven buckets for the bar chart, redrawn per range | B1 tab 1 channel split |
| `GET` | `/metrics/top-intents?range=…&limit=5` | `dashboard.view` | Ranked intents with counts scaled per range | B1 tab 1 top intents |
| `GET` | `/conversations` | `analytics.view` | Conversation explorer. `?outcome=all\|escalated\|resolved\|abandoned&channel=&intent=&rating=&range=&q=`. **Cursor-paginated** (§1.3). Returns masked user labels (`Ahmed R.`) — never a full name or an identifier, because this list is browsed casually and PII is masked before persistence anyway. | B1 tab 2 filter + table |
| `GET` | `/conversations/{id}` | `analytics.view` | Conversation header: outcome, rating, channel, intent, duration, PII-redaction status | B1 tab 2 `View transcript` footer |
| `GET` | `/conversations/{id}/transcript` | `analytics.view` | The inline thread. Already masked (§12 invariant 4) — there is no unmasked representation to request. Turns cursor-paginated. | B1 tab 2 `View transcript` |
| `GET` | `/conversations/{id}/trace` | `agents.manage` | The full agent trace and grounding sources for a turn. Higher permission than the transcript: this exposes prompts, tool arguments and model identities. | A2 diagnostics rail; B1 tab 2 |
| `POST` | `/conversations/{id}/exports` | `analytics.view` | Request a transcript export. `202` + job; the download is a short-lived signed URL. **Writes an audit entry** — B14 tab 2 seeds *"Exported 42 conversation transcripts"*, so data export is an audited action, not a quiet download. | B1 tab 2 `Export` |
| `GET` | `/exports/{id}` | `analytics.view` | Export status and signed download URL. Expired → `410 export.expired`. | B1 tab 2 |
| `POST` | `/evaluation/golden-sets/{setId}/cases` | `agents.manage` | **Add to golden set.** `{source:{conversationId}}`. Idempotent per `(setId, conversationId)`: a second attempt is `409 evaluation.case_already_added`, which is precisely what disables the wireframe's button and shows its confirmation text. Increments the set's case count in the same transaction, so B13 tab 1 shows 49 immediately. | B1 tab 2 `Add to golden set` → B13 tab 1 |
| `GET` | `/feedback/issues` | `analytics.view` | Thumbs-down review queue: issue text, volume, root-cause tag, status | B1 tab 3 queue |
| `POST` | `/feedback/issues/{id}/resolution` | `analytics.view` | `{status:"fixed"\|"open", note?}`. Drives both `Mark fixed` and `Reopen` — one idempotent transition endpoint rather than two verbs, because the control is a toggle. | B1 tab 3 `Mark fixed` / `Reopen` |
| `PATCH` | `/feedback/issues/{id}` | `analytics.view` | Re-tag the root cause (`missing_knowledge` \| `stale_source` \| `wrong_tool` \| `guardrail` \| `other`) | B1 tab 3 root-cause tag **[ASSUMPTION]** |
| `GET` | `/feedback/unanswered` | `analytics.view` | Unanswered questions clustered by frequency | B1 tab 3 table |
| `POST` | `/feedback/unanswered/{id}/resolution` | `knowledge.manage` | `{as:"knowledge_source"\|"flow", targetId?}`. Both resolutions remove the item from the queue. Requires `knowledge.manage`, not `analytics.view`, because it creates work in the build screens — this is the improvement loop closing (B1 rule). | B1 tab 3 two resolutions |

**15 endpoints.**

Metric endpoints are cached 60 s per `(tenant, range)` and carry `ETag`. `range` is a named window, not a free date pair, because that is what the wireframe's toggle offers and an unbounded custom range over 36,410 conversations is a table scan waiting to happen. **[ASSUMPTION]** A custom range would be added as `?from=&to=` with a 90-day span cap.

### 6.3 `agents` — B2 Registry, B3 Wizard

**Registry (B2).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/agents` | `agents.manage` | Registry list: owner, current version, status, bound channels, usage/day. `?status=&owner=&q=` | B2 seeded table |
| `POST` | `/agents` | `agents.manage` | Create a new agent as `Draft` at `v0.1` with an empty wizard draft | B3 entry point |
| `GET` | `/agents/{id}` | `agents.manage` | One agent with its current version and bindings | B2 |
| `PATCH` | `/agents/{id}` | `agents.manage` | Rename, change description or owning entity. Owning entity must be in the principal's `teamIds` unless scope is `all`. | B2 / B3 step 1 |
| `GET` | `/agents/{id}/versions` | `agents.manage` | Version history with change summaries — *v1.4 Added du/Etisalat lookup tool*, *v1.3 Tightened guardrail threshold*, … | B2 `Version history` |
| `GET` | `/agents/{id}/versions/{version}` | `agents.manage` | A frozen version's full configuration | B2 |
| `POST` | `/agents/{id}/clone` | `agents.manage` | Clone. Creates `<name> (copy)` as `Draft` at `v0.1`, copying every binding, and writes a first history entry *"Cloned from &lt;name&gt; v1.4"*. The clone is a distinct agent, not a version. | B2 `Clone` |
| `POST` | `/agents/{id}/publish` | `agents.publish` | Publish the draft as the next version. `Idempotency-Key` required. **Runs the publish gate first** (B13 tab 3): a failing suite → `409 agent.publish_gate_blocked` with `meta.{goldenSetId, goldenSetName, score, threshold, metric}` so the UI can say *"Arabic parity at 71% is below the 85% floor"* rather than "blocked". A bound locale below 100% translated → `409 agent.locale_gate_blocked`. Incomplete wizard → `422 agent.draft_incomplete` with `meta.missingSteps`. Already published → `409 agent.already_published`. Separation of duties: `agents.manage` builds, `agents.publish` releases (B9 rule). | B2 `Publish`; B3 step 10 `Publish agent` |
| `POST` | `/agents/{id}/unpublish` | `agents.publish` | Flip to `Draft`; the agent stops taking new conversations. Open conversations finish (same principle as B10 tab 1). Not published → `409 agent.not_published`. | B2 `Unpublish` |
| `POST` | `/agents/{id}/archive` | `agents.manage` | Remove from the registry. Refused with `409` while the agent is bound to a Live channel — archiving a live assistant must be a deliberate two-step, not a single click. Archived agents keep their versions and audit trail. | B2 `Archive` |
| `POST` | `/agents/{id}/versions/{version}/rollback` | `agents.publish` | Make a non-current version current and prepend a *"Rolled back to v1.3"* history entry. Rollback changes **which version is current**; it does not move anything between environments — promotion (B14 tab 1) does that, and the two are deliberately distinct (B2 rule). Target is already current → `409 agent.version_is_current`. | B2 `Roll back` |
| `GET` | `/agents/{id}/usage?range=…` | `dashboard.view` | Conversations/day, containment, cost — the registry's usage column | B2 usage column |
| `POST` | `/agents/creation-proposals` | `agents.manage` | **"Create with AI"** *(proxy → `apps/ai`'s `POST /v1/agents/creation-proposals`, §5.9)*. A business-language description in, one structured proposal out — identity, instructions, model, channels, guardrail overrides, tool bindings, a knowledge toggle, and a plain-language flow instruction, each grounded in this tenant's real, existing catalogs (never a fabricated tool/policy). Writes nothing. | B2 `Create with AI` |
| `POST` | `/agents/from-proposal` | `agents.manage` | Apply the staff-reviewed (and possibly edited) proposal above: creates the agent, then runs the same real per-step writes a manual wizard walk-through would (Instructions/Model, Channels, Guardrails, Tools, Knowledge, then the flow itself via the existing AI flow-editing call, §6.7). No shared transaction — stops and reports exactly which group failed rather than rolling back what already succeeded (mirrors the wizard's own "any step is directly clickable, state persists" contract); the agent already exists from the first group onward, so the caller always continues into the ordinary wizard afterward. | B2 `Create with AI` review screen `Create agent` |

**Wizard (B3) — save per step.**

The wizard does not force linear progress and all state persists when moving between steps, so the contract is a **persistent draft with per-step writes**, not one giant submit at the end.

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/agents/{id}/draft` | `agents.manage` | The whole draft plus per-step completion state and the progress percentage that drives the progress bar | B3 progress bar + 10-step strip |
| `PUT` | `/agents/{id}/draft/steps/{step}` | `agents.manage` | **Save one step.** `{step}` ∈ `identity` \| `instructions` \| `model` \| `tools` \| `knowledge` \| `flows` \| `guardrails` \| `channels` \| `test` \| `publish`. Idempotent full replacement of that step's payload; validated against that step's schema only. A step is savable while other steps are invalid — that is what "any step is directly clickable" requires. Returns the step, the recomputed completion state and any **cross-step warnings** (e.g. a bound Arabic locale while parity is 82%) as `meta.warnings`, which warn but never block a save. | B3 `Save & continue`, `Back`, and any tab click |
| `GET` | `/agents/{id}/draft/validation` | `agents.manage` | Publish-readiness: per-step errors, unsatisfied gate conditions, missing bindings. What the final step reads before enabling `Publish agent`. | B3 step 10 |
| `PUT` | `/agents/{id}/draft/skills` | `agents.manage` | Attach/detach catalogue skills. Body is the full set of attached skill ids, so the toggles cannot drift. Returns the summary-strip counts (attached skills, bound MCP tools, API connectors). | B3 step 4A skill toggles + summary strip |
| `PUT` | `/agents/{id}/draft/tool-bindings` | `agents.manage` | Bind/unbind discovered MCP tools and API connectors. **This is the tool-permission boundary**: a tool discovered on a server is callable only once bound here (B3 step 4 rule), and the runtime enforces it with `403 tools.not_bound` (§5.6). Binding an untested connector to an agent that is about to publish → `409 tools.connector_untested`. Because this writes the shared tools registry, the binding appears immediately in B5 (B3 ↔ B5 cross-wiring). | B3 step 4B/4C bindable pills |
| `PUT` | `/agents/{id}/draft/knowledge-bindings` | `agents.manage` | Bind knowledge collections (SEWA tariff schedule, Utilities providers directory, Sharjah Customs handbook) | B3 step 5 checkboxes |
| `PUT` | `/agents/{id}/draft/flow-bindings` | `agents.manage` | Bind flows. Binding a `Draft` flow is allowed but recorded as a publish-blocking warning — a published agent bound to an unpublished flow has no journey to run. | B3 step 6 |
| `PUT` | `/agents/{id}/draft/guardrails` | `agents.manage` | Per-agent guardrail settings. **Locked global policies are not in this schema**: a body carrying `maskPii` is `422 validation.failed` with `field.unknown`, and a request that reaches the governance layer anyway is `409 governance.policy_locked`. Structurally unenforceable to change (§12 invariant 5). | B3 step 7; B12 tab 1 |
| `PUT` | `/agents/{id}/draft/channels` | `agents.manage` | Bind channels — Web widget, WhatsApp, Kiosk/IVR | B3 step 8 |
| `POST` | `/agents/{id}/draft/sandbox-turns` | `agents.manage` | *(proxy → `POST /v1/sandbox/turns`)* Run a turn against the unsaved draft. SSE, full diagnostics, nothing persisted to a citizen conversation. | B3 step 9 sandbox preview |
| `GET` | `/agents/{id}/draft/version-preview` | `agents.publish` | The next version number and a generated change summary derived from the diff against the current version — B3 step 10's `v1.3 → v1.4` | B3 step 10 |

**25 endpoints.**

### 6.4 `orchestration` — B4 Router

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/orchestration/config` | `orchestration:manage` | Routing strategy, agent-selection scope (plus the explicit agent-id list when that scope is `ExplicitList`), execution mode, max hops, max loop iterations, both cost ceilings (tokens and micro-AED), conflict-resolution and merge policy, fallback agent. One tenant-wide singleton — there is no per-agent override (the two `[ASSUMPTION]` rows this table used to carry for that were never built and are removed below). | B4 router configuration form |
| `PUT` | `/orchestration/config` | `orchestration:manage` | **Corrected 2026-09-15 — gated on the dedicated `orchestration:manage` permission introduced this wave, not `agents:manage` as originally speculated; real implementation is `updateRouterConfigAction` (an `apps/web` Server Action), not a proxied REST call.** Replace the singleton. Validation mirrors the real `CK_RouterConfigs_*` database constraints: `maxHops` 1–10 (not 1–20 as earlier documented here), `maxLoopIterations` 1–20 (previously undocumented, same underlying constraint as `maxHops`), both `costCeilingTokens` and `costCeilingMicroAed` must be positive, `executionMode: "Parallel"`/`"SupervisorWorker"` requires a merge policy that resolves overlap (`ConcatenateInOrder` is rejected for those two modes, since it duplicates overlapping content with no dedup/rewrite step), `executionMode: "SupervisorWorker"` requires `maxHops ≥ 3`, `agentSelectionScope: "ExplicitList"` requires a non-empty agent-id list where every id is a currently `Published` agent. There is no "removing the fallback agent while a channel is Live → `422`" rule — no "Live channel" concept exists anywhere in the real schema or in `apps/ai`'s `ProcessTurn`, which never reads `fallbackAgentId` at all; that field is accepted and saved for future use but not yet enforced by the router, and the form discloses this directly. `agentSelectionScope: "ChannelBound"` is likewise accepted and saved but not yet enforced — every published agent is still considered, the same as `AllPublished`, until channel-bound routing is implemented. | B4 router configuration form |
| `POST` | `/orchestration/trace-preview` | `orchestration:manage` | **Corrected 2026-09-15 — gated on `orchestration:manage`, not `agents:manage` as originally speculated.** A direct Server Action passthrough (`previewTraceAction` → `AiServiceOrchestrationPreviewClient` → `getTenantScopedAiClient()`) to `POST /v1/orchestration/trace-preview` (§5.7) — no application-layer logic of its own on the `apps/web` side, since the real routing/merge logic lives entirely in `apps/ai`'s `ProcessTurn`, validated against the tenant's real, currently-*saved* `RouterConfig`. Body: `{primaryAgentId, content, locale}`. This is what makes B4's "Test a prompt" simulator show a real trace for a real prompt — unpersisted, no real cost — rather than a canned example. | B4 "Test a prompt" |

**3 endpoints.**

### 6.5 `tools` — B5 registry, shared with B3 step 4

The same underlying data as the wizard's step 4; binding in either place is visible in the other immediately (B3 ↔ B5 cross-wiring). There is one resource, viewed two ways.

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/tools/skills` | `agents.manage` | Platform skills catalogue with per-agent attachment counts | B5 tab 1; B3 step 4A |
| `POST` | `/tools/skills` | `agents.manage` | Register a skill. Note the B3 rule that every API connector automatically becomes a callable skill with its own schema and rate-limit policy — those are created by the connector path below, not here. | B5 tab 1 **[ASSUMPTION]** |
| `PATCH` | `/tools/skills/{id}` | `agents.manage` | Rename, edit description, edit rate-limit policy | B5 tab 1 **[ASSUMPTION]** |
| `DELETE` | `/tools/skills/{id}` | `agents.manage` | Delete. Bound to any agent → `409` with the binding list; unbind first. | B5 tab 1 **[ASSUMPTION]** |
| `GET` | `/tools/mcp-servers` | `agents.manage` | Servers with endpoint, auth type and connection state | B5 tab 2; B3 step 4B |
| `POST` | `/tools/mcp-servers` | `agents.manage` | `{name, endpoint, auth:{type:"oauth2_client_credentials"\|"mtls"\|"none", …}}`. Secrets go to the secret store; the response never echoes them. Endpoint must be `mcp://` or `https://` and must resolve — a typo caught at registration is cheaper than a broken tool at turn time. | B3 step 4B `+ Add MCP server` |
| `PATCH` | `/tools/mcp-servers/{id}` | `agents.manage` | Edit endpoint or auth. Changing either marks the server `not_connected` and invalidates its discovered descriptors — a descriptor set from a different endpoint is a lie. | B5 tab 2 |
| `DELETE` | `/tools/mcp-servers/{id}` | `agents.manage` | Remove server and descriptors. Bound tools → `409` listing the agents. | B5 tab 2 |
| `POST` | `/tools/mcp-servers/{id}/connect` | `agents.manage` | *(proxy → `/v1/tools/mcp/servers/{id}/connect`)* **Connect & discover.** Returns discovered tools as bindable pills — the wireframe's Customs server returning `get_declaration_status`, `submit_customs_form`, `list_fees`. | B3 step 4B `Connect & discover tools` |
| `POST` | `/tools/mcp-servers/{id}/disconnect` | `agents.manage` | *(proxy)* Close the session, keep descriptors | B5 tab 2 **[ASSUMPTION]** |
| `GET` | `/tools/mcp-servers/{id}/tools` | `agents.manage` | *(proxy)* Discovered descriptors with schemas | B3 step 4B pills |
| `GET` | `/tools/connectors` | `agents.manage` | API connectors with method, endpoint, auth and tested state | B5 tab 3; B3 step 4C |
| `POST` | `/tools/connectors` | `agents.manage` | `{name, method, endpoint, auth, requestSchema, responseMapping}`. Created `untested`. **Also creates the matching callable skill** with its schema and rate-limit policy, in the same transaction (B3 step 4 rule) — the automatic-skill behaviour is a transactional guarantee, not a background sync. | B3 step 4C `+ Add API connector` |
| `PATCH` | `/tools/connectors/{id}` | `agents.manage` | Edit. Changing method, endpoint or auth resets `tested` to false — the badge must never claim a test that covered a different request. | B5 tab 3 |
| `DELETE` | `/tools/connectors/{id}` | `agents.manage` | Remove connector and its derived skill. Bound → `409`. | B5 tab 3 |
| `POST` | `/tools/connectors/{id}/test` | `agents.manage` | *(proxy → `/v1/tools/connectors/{id}/test`)* **Test connection.** Flips the badge to `Tested` on success and returns a redacted sample response — the wireframe's revealed sample JSON. Failure returns `200` with `{ok:false, reason}` and leaves the badge `Untested`. | B3 step 4C `Test connection` |
| `POST` | `/tools/invocations` | `agents.manage` | *(proxy → `/v1/tools/invocations`)* Invoke one tool by hand for debugging. Same binding and breaker checks as the runtime — a debug path that bypasses the tool-permission boundary would make that boundary meaningless. | B5 **[ASSUMPTION]** |
| `GET` | `/tools/breakers` | `agents.manage` | *(proxy)* Live breaker state: trips-at, cooldown, fallback, current state | B5 tab 4 table |
| `PUT` | `/tools/breakers/{service}` | `agents.manage` | Configure threshold, window, cooldown and fallback strategy (`apologise_offer_agent` \| `serve_cached` \| `queue_and_retry`) | B5 tab 4 |
| `POST` | `/tools/breakers/{service}/reset` | `agents.manage` | *(proxy)* Close the breaker. Audited — manually closing a breaker over a genuinely broken dependency is an operational decision someone must own. | B5 tab 4 `Reset breaker` |
| `POST` | `/tools/breakers/{service}/trip` | `agents.manage` | *(proxy)* Trip manually, to demonstrate or verify the fallback path. `{reason}` required; refused in Production unless the principal is `Super Admin`. **[ASSUMPTION]** | B5 tab 4 `Trip manually (test)` |
| `GET` \| `PUT` | `/tools/resilience-config` | `agents.manage` | *Serve cached answers while a source is down* toggle, cache max age (24 h), and the degraded-mode message | B5 tab 4 toggle + message |

**23 endpoints.**

### 6.6 `knowledge` — B6 Graph RAG

Every row here is a proxy: Neo4j and Qdrant belong to `shj3-ai`. `shj3-web` owns the SQL Server `Source` records and the audit write, then forwards.

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/knowledge/sources` | `knowledge.manage` | Sources with type, owner, schedule, indexed %, last crawled | B6 tab 1 table |
| `POST` | `/knowledge/sources` | `knowledge.manage` | *(proxy)* Add a source: `{name, type:"document"\|"url_crawler"\|"database"\|"sharepoint"\|"api_feed", location, schedule:"manual"\|"daily"\|"weekly"}`; `multipart` when the type is `document`. `202` + ingest job. | B6 tab 1 `+ Add source` |
| `PATCH` | `/knowledge/sources/{id}` | `knowledge.manage` | Rename, change schedule or owner. Changing `location` triggers a re-index rather than silently keeping stale content. | B6 tab 1 **[ASSUMPTION]** |
| `DELETE` | `/knowledge/sources/{id}` | `knowledge.manage` | *(proxy)* Remove. `202` — the cascade spans three stores. Sole grounding for a published agent → `409` naming the agents. | B6 tab 1 `Remove` |
| `POST` | `/knowledge/sources/{id}/recrawl` | `knowledge.manage` | *(proxy)* Re-crawl now. `202` + job; on completion, indexed → 100% and last-crawled → *just now*. | B6 tab 1 `Re-crawl now` |
| `GET` | `/knowledge/graph` | `knowledge.manage` | *(proxy)* Nodes and edges for the explorer. Entities: Service, Provider, Fee, Document, Channel. | B6 tab 2 canvas |
| `GET` | `/knowledge/graph/entities?q=…` | `knowledge.manage` | *(proxy)* Entity search, driving the live dimming of non-matching nodes | B6 tab 2 `Search entities` |
| `GET` | `/knowledge/graph/nodes/{id}` | `knowledge.manage` | *(proxy)* Node detail — the meaning shown on click | B6 tab 2 node click |
| `POST` | `/knowledge/graph/nodes` | `knowledge.manage` | *(proxy)* Add a node with `{type, label, parentId}`; node and parent edge created together so it is placed, edged and immediately clickable | B6 tab 2 `+ Add node` |
| `PATCH` | `/knowledge/graph/nodes/{id}` | `knowledge.manage` | *(proxy)* Edit label/properties **[ASSUMPTION]** | B6 tab 2 |
| `DELETE` | `/knowledge/graph/nodes/{id}` | `knowledge.manage` | *(proxy)* Delete node and edges **[ASSUMPTION]** | B6 tab 2 |
| `GET` | `/knowledge/duplicates` | `knowledge.manage` | *(proxy)* Duplicate candidates with similarity — `SEWA ↔ Sharjah Electricity & Water Authority` | B6 tab 2 duplicate detection |
| `POST` | `/knowledge/duplicates/{id}/merge` | `knowledge.manage` | *(proxy)* Merge with a chosen survivor; edges re-pointed, alias recorded, merge reversible | B6 tab 2 `Merge` |
| `POST` | `/knowledge/duplicates/{id}/ignore` | `knowledge.manage` | *(proxy)* Dismiss the pair | B6 tab 2 `Ignore` |
| `GET` \| `PUT` | `/knowledge/retrieval-config` | `knowledge.manage` | *(proxy)* Chunk size, overlap, embedding model, hybrid weighting slider, top-K, reranker toggle. `If-Match` required. **Changing the embedding model returns `202` with a mandatory full re-index and a warning** — the dropdown triggers a re-index, it does not just save a preference ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 3). | B6 tab 3 settings + slider |
| `POST` | `/knowledge/retrieval/queries` | `knowledge.manage` | *(proxy → `/v1/retrieval/query`)* **Retrieval playground.** Returns ranked passages with scores and the matched subgraph. Accepts an inline config override so the playground can experiment without touching production retrieval. | B6 tab 3 playground `Run` |
| `POST` | `/knowledge/chunking/preview` | `knowledge.manage` | *(proxy)* Preview chunk boundaries before committing a re-index **[ASSUMPTION]** | B6 tab 3 |
| `GET` | `/knowledge/reindex-jobs` | `knowledge.manage` | *(proxy → `/v1/jobs?type=knowledge.*`)* Job history with Completed/Failed status | B6 tab 3 re-index jobs |
| `POST` | `/knowledge/reindex-jobs` | `knowledge.manage` | *(proxy)* Re-index all sources now. `Idempotency-Key` required; `202` + a Running job that resolves to Completed. Already running → `409` with the running job. | B6 tab 3 `Re-index all sources now` |
| `POST` | `/knowledge/reindex-jobs/{id}/cancel` | `knowledge.manage` | *(proxy)* Cancel; cooperative, leaves the index consistent **[ASSUMPTION]** | B6 tab 3 |
| `GET` \| `PUT` | `/knowledge/conflict-policy` | `knowledge.manage` | *(proxy)* `prefer_most_recent` \| `prefer_owning_entity` \| `always_ask_admin`. The second seeded conflict is deliberately awkward — the more recent source holds the less authoritative value — which is why this is a choice and not a constant. | B6 tab 4 default policy |
| `GET` | `/knowledge/conflicts` | `knowledge.manage` | *(proxy)* Conflicts with both sides, values, sources and freshness | B6 tab 4 table |
| `POST` | `/knowledge/conflicts/{id}/resolve` | `knowledge.manage` | *(proxy)* `{authoritativeSourceId}` — `Make authoritative` on either side. Re-scores affected passages, clears `conflicted`, and thereby restores the grounding confidence that the conflict was suppressing (B6 tab 4 → B12). | B6 tab 4 `Make authoritative` |

**25 endpoints.**

---
### 6.7 `flows` — B7 Flow designer

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/flows` | `agents.manage` | Flows with status and bound agents | B3 step 6; B7 |
| `POST` | `/flows` | `agents.manage` | Create a flow. Seeded with a greeting node **and a reachable free-text escape condition node**, so a new flow cannot start out violating the escape rule. | B7 canvas |
| `GET` | `/flows/{id}` | `agents.manage` | Full graph: nodes, edges, node configuration | B7 canvas |
| `PUT` | `/flows/{id}` | `agents.manage` | Replace the graph in one write. `If-Match` required. The graph is the unit of edit — a canvas save that applied node-by-node could leave a dangling edge visible to the runtime. | B7 canvas |
| `POST` | `/flows/{id}/nodes` | `agents.manage` | Add a node: `message` \| `question` \| `tool_call` \| `handover` \| `condition` | B7 node types |
| `PATCH` | `/flows/{id}/nodes/{nodeId}` | `agents.manage` | Edit the inspector panel for one node — greeting text and chips; question options bound to the Provider list; tool name, arguments, retry policy; handover triggers; condition expression | B7 inspector panel |
| `DELETE` | `/flows/{id}/nodes/{nodeId}` | `agents.manage` | Delete a node and its edges. Deleting the last escape-condition node is allowed on a draft but blocks publish (below) — the editor must not fight the author mid-edit. | B7 |
| `POST` | `/flows/{id}/validate` | `agents.manage` | Structural validation: unreachable nodes, dangling edges, cycles with no exit, tool nodes referencing unbound tools, and **free-text escape reachability from every node**. Returns findings; never mutates. | B7 rule — escape available at every node |
| `POST` | `/flows/{id}/publish` | `agents.publish` | Publish the flow. **`422 flow.escape_node_required` if any node cannot reach a free-text escape** — the brief's requirement that the flow never traps the user is enforced here, structurally, not left to the author's memory. `422 flow.graph_invalid` for the other structural faults, with each finding as a field error. | B7; B3 step 6 |
| `POST` | `/flows/{id}/simulate` | `agents.manage` | Walk the flow with a scripted input sequence and return the node path, slot state and any escape. Cheaper than a sandbox turn because no model is called. **[ASSUMPTION]** | B7 |
| `GET` | `/flows/ai-settings` | `agents.manage` | The tenant-wide `primaryModel`/`fallbackModel` the AI sidebar (§5.9) uses, seeded with `SHJ3_FLOW_EDIT_MODEL`'s own default (`anthropic/claude-sonnet-5`, no fallback) on first read. | B7 AI settings |
| `PUT` | `/flows/ai-settings` | `agents.manage` | Update `primaryModel`/`fallbackModel`. `422 flows.primary_model_required` if `primaryModel` is blank — free text otherwise, no allowlist (matches `AgentVersion.primaryModel`'s own convention). | B7 AI settings |

**12 endpoints.**

Handover node configuration is the seam to B8: its two triggers — *confidence below the threshold* and *tool call failed twice* — are exactly two of the three escalation reasons B8's queue reports (B7 rule). They are stored on the node and copied onto the ticket at escalation time, so the flow definition and the operational queue cannot drift.

### 6.8 `handover` — B8 Human agent workspace

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/handover/presence` | `escalations.handle` | The signed-in agent's presence | B8 agent status |
| `PUT` | `/handover/presence` | `escalations.handle` | `{status:"available"\|"busy"\|"offline"}`. Going `offline` while holding tickets returns them to the queue with their original priority and wait-time clock preserved — a ticket must not be punished for an agent signing off. | B8 `● Available / ● Busy / ● Offline` |
| `GET` | `/handover/queue` | `escalations.handle` | Escalation queue: user, topic, channel, waiting time, priority. Sorted by the routing outcome, not by insertion order. | B8 queue table |
| `GET` | `/handover/tickets/{id}` | `escalations.handle` | Ticket detail: transcript, customer context (`SEWA account ending 4821 · Verified via UAE PASS`), escalation reason, pending slot, identity/assurance state | B8 per-ticket detail |
| `POST` | `/handover/tickets/{id}/claim` | `escalations.handle` | Claim. Atomic — the second claimant gets `409 handover.ticket_already_claimed`. Claiming while `offline` → `409 handover.agent_offline`. On success the transcript, identity state and pending slot are all attached: escalation is not a restart (A3 rule). | B8 ticket selection |
| `POST` | `/handover/tickets/{id}/release` | `escalations.handle` | Return to the queue with a reason | B8 **[ASSUMPTION]** |
| `POST` | `/handover/tickets/{id}/messages` | `escalations.handle` | Send an agent message to the citizen. `Idempotency-Key` required (outbound). Goes through `ChannelTransport`, so the **WhatsApp 24-hour window is checked here too**: a closed window is `409 conversation.session_window_closed` with `meta.requiredTemplate: true`. An agent cannot bypass a platform rule by typing faster. | B8 composer |
| `GET` | `/handover/tickets/{id}/canned-replies` | `escalations.handle` | Topic-specific canned replies — 3 billing, 3 customs, 3 library | B8 canned replies |
| `POST` | `/handover/tickets/{id}/resolve` | `escalations.handle` | Close with `{outcome:"resolved"\|"abandoned", note}`. Feeds B1 tab 2's outcome column. | B8 **[ASSUMPTION]** |
| `POST` | `/handover/tickets/{id}/return-to-bot` | `escalations.handle` | Hand control back to the assistant, restoring the preserved flow state and pending slot. **[ASSUMPTION]** — A3 pauses the composer for a human; the reverse transition is required for the conversation to continue afterwards. | A3; B8 |
| `GET` | `/handover/routing-rules` | `routing.manage` | Ordered rule list with enabled state. Order **is** the semantics: top to bottom, first active match wins. | B8 routing rules table |
| `POST` | `/handover/routing-rules` | `routing.manage` | Add a rule: `{attribute:"topic"\|"priority"\|"channel"\|"wait_time", operator, value, routeTo}`. Operator is constrained by attribute — `>` for `wait_time`, `=` for the others; anything else is `422 routing_rule.operator_invalid`, mirroring the form's auto-switching operator. Appended last, so adding a rule never silently changes existing routing. | B8 `+ Add rule` |
| `PATCH` | `/handover/routing-rules/{id}` | `routing.manage` | Edit condition or target. Same operator constraint. | B8 `Edit` (same form, pre-filled) |
| `DELETE` | `/handover/routing-rules/{id}` | `routing.manage` | Delete | B8 `Delete` |
| `POST` | `/handover/routing-rules/{id}/enable` | `routing.manage` | Enable. Idempotent → `204` when already enabled. | B8 `Enable` |
| `POST` | `/handover/routing-rules/{id}/disable` | `routing.manage` | Disable. A disabled rule keeps its position — it is skipped, not removed — so re-enabling restores the previous behaviour exactly. | B8 `Disable` |
| `PUT` | `/handover/routing-rules/order` | `routing.manage` | **Reorder.** Body is the complete ordered id list; `If-Match` **required** on the collection's `ETag`. A stale order → `409 routing_rule.order_conflict` with the current order. Rejecting the whole list on a mismatch is the point: `Move up` / `Move down` on a list someone else has reordered would otherwise produce an order neither admin intended. A list missing or duplicating an id → `422`. | B8 `Move up` / `Move down` |
| `POST` | `/handover/routing-rules/test` | `routing.manage` | **The rule tester.** See below. | B8 `Run test` |

**18 endpoints.**

**The rule tester evaluates the live, unsaved order.** This is the requirement, and it dictates the contract: the endpoint accepts the rule list in the request body rather than reading the persisted one.

```http
POST /api/backoffice/handover/routing-rules/test
Content-Type: application/json

{
  "ticket":   { "topic": "billing", "priority": "high", "channel": "web", "waitTimeMinutes": 2 },
  "ruleSet":  { "mode": "provided",
                "rules": [
                  { "id": "r2", "attribute": "priority", "operator": "eq", "value": "high",     "routeTo": "senior_agents",       "enabled": true },
                  { "id": "r1", "attribute": "topic",    "operator": "eq", "value": "billing",  "routeTo": "sewa_billing_team",   "enabled": true },
                  { "id": "r3", "attribute": "channel",  "operator": "eq", "value": "whatsapp", "routeTo": "whatsapp_agents",     "enabled": false },
                  { "id": "r4", "attribute": "wait_time","operator": "gt", "value": 5,          "routeTo": "requeue_supervisor",  "enabled": true }
                ] }
}
```

```json
{
  "matched": true,
  "firedRule": { "id": "r2", "position": 1, "condition": "Priority = High", "routeTo": "senior_agents",
                 "routeToLabel": "Senior agents" },
  "evaluation": [
    { "position": 1, "id": "r2", "enabled": true,  "matched": true,  "reason": "priority == high" },
    { "position": 2, "id": "r1", "enabled": true,  "matched": null,  "reason": "not_evaluated_first_match_won" },
    { "position": 3, "id": "r3", "enabled": false, "matched": null,  "reason": "disabled" },
    { "position": 4, "id": "r4", "enabled": true,  "matched": null,  "reason": "not_evaluated_first_match_won" }
  ],
  "ruleSetSource": "provided",
  "differsFromSaved": true
}
```

Contract rules:

1. `ruleSet.mode: "provided"` evaluates the supplied list **exactly as given** — including a reorder, a disable or an edit the admin has not saved. `mode: "persisted"` evaluates the stored list. The UI always sends `provided`, because that is the whole value of the tester: *it proves the change before it goes live* (B8 rule).
2. **The endpoint is pure.** It writes nothing, not even the tester input. It is a `POST` only because the rule list is a body, not because it mutates.
3. `evaluation` returns the full walk with a reason per rule, so the tester explains *why* rather than only *where*. With the seeded order, Billing + High routes to the SEWA billing team (rule 1 wins); with rules 1 and 2 swapped as above, the same ticket routes to Senior agents — and `differsFromSaved: true` tells the admin they are looking at an unsaved hypothesis.
4. No match → `matched: false`, `firedRule: null`, `defaultQueue` named. Falling to the default queue is a legitimate outcome, not an error.
5. `ruleSet.rules` is capped at 200 entries and validated with the same schema as a real rule, so the tester cannot be used to evaluate a rule shape the system would refuse to save.

### 6.9 `channels` — B10 Channel configurations

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/channels` | `agents.manage` | Four channels with bound agent, hours and state | B10 tab 1 table |
| `PATCH` | `/channels/{id}` | `agents.manage` | Set `state: "live" \| "disabled"` and the bound agent. Going Live with no bound agent → `422 channel.agent_required`. Disabling stops **new** conversations immediately and lets open ones finish (B10 tab 1 rule): the response returns `meta.openConversations` so the UI can say how many are draining. | B10 tab 1 `Live` / `Disabled` |
| `GET` \| `PUT` | `/channels/handover-hours` | `agents.manage` | Human-agent working hours (`Sun–Thu 08:00–20:00`, `Sat 09:00–14:00`, `Asia/Dubai`), UAE public-holiday auto-sync, *assistant available 24/7 even when agents are offline*, and the no-agent-available message. Assistant hours and agent hours are separate fields precisely because the assistant may run 24/7 while escalation is only offered when staffed — otherwise users are promised a handover that cannot happen (B10 tab 1 rule). | B10 tab 1 out-of-hours |
| `GET` \| `PUT` | `/channels/web-widget` | `agents.manage` | Accent colour, launcher position, default state, disclaimer text, greeting text, composer placeholder. `PUT` returns the recomputed embed snippet, so the live preview and the snippet cannot disagree. Accent colour is validated for **WCAG 2.1 AA contrast** against the bubble and chip backgrounds → `422 theming.contrast_violation` (§7). | B10 tab 2 settings + live preview |
| `GET` | `/channels/web-widget/embed-snippet` | `agents.manage` | The snippet carrying the chosen colour and the channel key | B10 tab 2 `Copy` |
| `GET` | `/channels/web-widget/allowed-domains` | `agents.manage` | Domain chips — `sharjah.ae`, `services.shj.ae` | B10 tab 2 |
| `POST` | `/channels/web-widget/allowed-domains` | `agents.manage` | Add a domain. Validated as a host or single-label wildcard (`*.sharjah.ae`); an IP, a path, a scheme or a bare TLD → `422 channels.domain_invalid`. This list is a **security control** (§4.1), not a preference — it is audited. | B10 tab 2 addable chips |
| `DELETE` | `/channels/web-widget/allowed-domains/{domain}` | `agents.manage` | Remove a domain. Removing the last one while the widget channel is Live → `422`: an empty allow-list would either lock everyone out or, if implemented as "no restriction", open the widget to any site. | B10 tab 2 removable chips |
| `GET` \| `PUT` | `/channels/whatsapp` | `agents.manage` | Number, BSP, *opt-in required before first message*, session-window hours (24). The window length is read-only in effect — it is Meta's rule, surfaced rather than configured. | B10 tab 3 settings |
| `GET` | `/channels/whatsapp/templates` | `agents.manage` | Templates with status: `welcome_message` Approved, `bill_reminder` Approved, `appointment_confirmation` Pending review | B10 tab 3 table |
| `POST` | `/channels/whatsapp/templates` | `agents.manage` | **Submit a new template.** `{name, category, language, body, variables[]}`. `Idempotency-Key` required — a double submit would create two Meta review items. Enters as `pending`. Duplicate name → `409 channels.template_duplicate_name`. Body placeholder count must match `variables.length` → `422`. | B10 tab 3 `+ Submit new template` |
| `GET` | `/channels/whatsapp/templates/{id}` | `agents.manage` | Template with its review status, rejection reason if any, and the campaigns depending on it | B10 tab 3 → tab 4 |
| `POST` | `/channels/whatsapp/templates/{id}/approve` | `agents.publish` | Record approval. **This is the dependency that unblocks the campaign** (B10 tab 3 → tab 4). Approval is normally driven by the BSP webhook (§10.1); this endpoint exists for the local/mock BSP adapter and for a manual override, and requires `agents.publish` because it releases outbound messaging capability. In one transaction: template → `approved`, every campaign whose only blocker was this template → `ready`, audit entry. | B10 tab 3 status → tab 4 unblock |
| `POST` | `/channels/whatsapp/templates/{id}/reject` | `agents.publish` | Record rejection with a reason. Any campaign depending on it stays `blocked` and its toggle stays inert. | B10 tab 3 **[ASSUMPTION]** |
| `GET` | `/channels/campaigns` | `agents.manage` | Campaigns with template, trigger, audience, sent count and state. **`state` is derived, never stored**: `blocked` whenever the template is not approved, `on`/`off` otherwise. Deriving it is why approving a template in tab 3 unblocks tab 4 with no sync step — there is nothing to sync. | B10 tab 4 table |
| `POST` | `/channels/campaigns` | `agents.manage` | Create: `{name, templateId, trigger, audienceQuery, enabled:false}` | B10 tab 4 **[ASSUMPTION]** |
| `PATCH` | `/channels/campaigns/{id}` | `agents.manage` | Edit trigger or audience | B10 tab 4 **[ASSUMPTION]** |
| `POST` | `/channels/campaigns/{id}/enable` | `agents.manage` | Arm the campaign. `Idempotency-Key` required. **Template not approved → `409 channels.template_not_approved`** with `meta.templateName` and `meta.templateStatus`. The dependency is enforced, not merely described (B10 tab 4 rule) — the toggle cannot be turned on, and the API is the thing that refuses, so no client can fake it. | B10 tab 4 `On` toggle |
| `POST` | `/channels/campaigns/{id}/disable` | `agents.manage` | Disarm. Idempotent. In-flight sends already queued are cancelled where the BSP allows it and otherwise counted. | B10 tab 4 toggle |
| `POST` | `/channels/campaigns/{id}/send-now` | `agents.publish` | Immediate fan-out. `Idempotency-Key` required. `202` + job. Every send-time check applies per recipient (§10.3): approved template **and** recorded opt-in **and** outside quiet hours. `409 channels.quiet_hours` if the whole window is closed; individual recipients failing opt-in are skipped and reported, not fatal. Requires `agents.publish` — pushing an unsolicited message to thousands of citizens is a release action. | B10 tab 4 **[ASSUMPTION]** |
| `GET` | `/channels/campaigns/{id}/sends` | `analytics.view` | Per-send log: recipient hash, template, outcome, skip reason. This is the evidence that the send-time checks ran. | B10 tab 4 `Sent` counts |
| `GET` \| `PUT` | `/channels/quiet-hours` | `agents.manage` | `{start:"21:00", end:"07:00", timeZone:"Asia/Dubai", enabled:true}` | B10 tab 4 quiet hours |
| `GET` | `/channels/locales` | `agents.manage` | Locales with voice, direction, translated percentage and fallback flag — English 100% LTR, Arabic 82% RTL | B10 tab 5 table |
| `PATCH` | `/channels/locales/{code}` | `agents.manage` | Set voice or direction | B10 tab 5 |
| `POST` | `/channels/locales/{code}/fallback` | `agents.manage` | Set as fallback. Exactly one locale is the fallback; setting a new one clears the old in the same transaction. Clearing the only fallback → `422 channels.fallback_locale_required`. | B10 tab 5 `Set as fallback` |
| `GET` | `/channels/locales/{code}/coverage` | `agents.manage` | Translation coverage by surface, and the agents whose publish is blocked by it — the mechanism behind the locale gate (B10 tab 5 → B13 tab 3) | B10 tab 5; B13 tab 3 |

**30 endpoints.**

### 6.10 `verification` — B11 tabs 1, 2, 5

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/verification/providers` | `users.manage` | UAE PASS, OTP to registered mobile, Emirates ID scan — with type, note and on/off state. **[ASSUMPTION]** on the permission: the B9 matrix has no identity row, and this configuration decides whether money can move against an unverified person, so it takes the narrowest permission in the matrix. | B11 tab 1 table |
| `PATCH` | `/verification/providers/{id}` | `users.manage` | Toggle a provider. Disabling the last enabled provider while any step-up rule requires `verified` → `422`: a rule that can never be satisfied silently blocks every payment. Selecting an adapter with no implementation → `501 adapter.not_implemented`. Audited. | B11 tab 1 `On` / `Off` |
| `GET` \| `PUT` | `/verification/ownership-check` | `users.manage` | *Verify the user actually owns the account number they supply.* The single most consequential toggle in the prototype, so: `If-Match` required, `{enabled, reason}` with `reason` mandatory when disabling, an audit entry naming the actor, and `meta.warning` describing the exposure (a user could look up or pay against an account they do not hold). | B11 tab 1 account-ownership check |
| `GET` | `/verification/step-up-rules` | `users.manage` | The action → required-assurance map | B11 tab 2 table |
| `PUT` | `/verification/step-up-rules/{action}` | `users.manage` | Set the required assurance for `view_bill_balance` \| `link_utility_account` \| `initiate_payment` \| `change_registered_mobile`. **Lowering `initiate_payment` below `verified_otp` requires `{acknowledgement:"…"}`** and is audited; without it, `422`. The rule is applied **before** the tool call, never after (B11 tab 2 rule), and that ordering is a property of the runtime (§5.1 stage 3), not of this configuration. | B11 tab 2 |
| `GET` \| `PUT` | `/verification/stitching` | `users.manage` | Stitch across channels on/off; stitching key (`verified_emirates_id_hash` \| `mobile_number` \| `never`); memory scope (`per_verified_identity` \| `per_channel_session` \| `none`); retention (`30d` \| `90d` \| `1y`). **Stitching only ever joins verified sessions** — that is not configurable: an anonymous web chat is never merged into a verified WhatsApp identity, and an attempt to stitch an anonymous session is `409 verification.stitching_requires_verified` (B11 tab 5 rule). | B11 tab 5 settings |

**8 endpoints.**

### 6.11 `payments` — B11 tabs 3, 4

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/payments/gateways` | `users.manage` | Sharjah Pay gateway (Card, Apple Pay, bank transfer — Live), SEWA direct debit (Bank mandate — Sandbox). **[ASSUMPTION]** on the permission, for the same reason as §6.10. | B11 tab 3 table |
| `PATCH` | `/payments/gateways/{id}` | `users.manage` | Enable/disable methods, switch `sandbox` ↔ `live`. Switching to `live` requires a successful connectivity check within the last hour, else `409`. Credentials are write-only: they go to the secret store and are never returned. Audited. | B11 tab 3 |
| `GET` \| `PUT` | `/payments/receipt-settings` | `users.manage` | Send in-conversation, email a PDF copy, allow refund requests from the assistant | B11 tab 3 receipt settings |
| `GET` | `/payments/transactions` | `analytics.view` | Transaction log, cursor-paginated: `?status=&service=&range=&q=<reference>`. Amounts as minor units + currency (§1.8). | B11 tab 4 table |
| `GET` | `/payments/transactions/{reference}` | `analytics.view` | One transaction with its gateway event history, conversation link and receipt | B11 tab 4 |
| `POST` | `/payments/transactions/{reference}/refund/approve` | `users.manage` | **Approve refund** → `Refunded`. `Idempotency-Key` required. `If-Match` on the transaction. No pending refund → `409 payments.refund_not_requested`; already resolved → `409 payments.refund_already_resolved`; amount over the settled amount → `422 payments.amount_mismatch`; outside the window → `409 payments.refund_window_expired`. The gateway call and the state change are reconciled by the callback (§10.2), so an approval whose gateway call fails leaves the transaction in `refund_pending_gateway` rather than lying about a refund that did not happen. Audit entry in the same transaction. **[ASSUMPTION]** on the permission — B9 has no finance row, and approving a refund moves money, so it takes `users.manage` (Super Admin only). | B11 tab 4 `Approve refund` |
| `POST` | `/payments/transactions/{reference}/refund/decline` | `users.manage` | **Decline** → back to `Settled`, with `{reason}` mandatory. Same idempotency, same conflict codes, same audit rule. | B11 tab 4 `Decline` |
| `GET` | `/payments/transactions/{reference}/receipt` | `analytics.view` | Receipt document (PDF or JSON per `Accept`) | B11 tab 3 receipts |

**9 endpoints.**

Transaction records follow the statutory **7-year** retention regardless of the transcript retention setting (B14 tab 4 carve-out). The deletion path enforces it: an erasure request that would remove a transaction row is `409 governance.erasure_conflicts_with_retention`, and the conversation transcript is erased while the financial record is retained with the citizen reference pseudonymised.

### 6.12 `governance` — B12 Guardrails, B14 Governance & ops

**Policies (B12).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/governance/policies` | `agents.manage` | The five global policies with detail, default, current value and `locked` flag | B12 tab 1 table |
| `PATCH` | `/governance/policies/{id}` | `agents.publish` | Change an **unlocked** policy. `If-Match` required. A **locked** policy (`mask_pii`, `prompt_injection_filter`) is rejected with **`409 governance.policy_locked`** — never silently ignored (§12 invariant 5). Two layers make it structural: the write schema for a locked policy admits no `enabled` field, so a body carrying one fails `422 validation.failed` with `field.unknown`; and the governance layer independently refuses the change, so even a hand-crafted request that satisfies the schema is refused. Audited with before/after values — B14 tab 2 seeds *"Changed global policy: grounding threshold 55% → 60%"*. | B12 tab 1 toggles |
| `GET` | `/governance/policies/{id}/history` | `analytics.view` | Change history for one policy, from the audit log | B12; B14 tab 2 **[ASSUMPTION]** |
| `GET` | `/governance/overrides` | `agents.manage` | Per-agent overrides with the stated reason | B12 tab 2 table |
| `POST` | `/governance/overrides` | `agents.publish` | Create an override: `{agentId, policyId, value, reason}`. **`reason` is mandatory** → `422 governance.override_reason_required` (B12 tab 2 rule: overrides are few and always carry a reason). An override against a **locked** policy is `422 governance.override_forbidden_for_locked_policy` — locked policies never appear here, and the API is what guarantees that rather than the UI omitting them. A stricter-than-global value (75% vs 60%) is always permitted; a looser one requires `{acknowledgement}`. | B12 tab 2 |
| `DELETE` | `/governance/overrides/{id}` | `agents.publish` | **Remove override** — the agent returns to global policy. `204`. | B12 tab 2 `Remove override` |

**Environments and promotions (B14 tab 1).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/governance/environments` | `dashboard.view` | Development / UAT / Production with agent counts, versions per environment and the promotion target | B14 tab 1 table |
| `GET` | `/governance/promotions` | `dashboard.view` | Pending and historical promotions with path, requester and status | B14 tab 1 pending promotions |
| `POST` | `/governance/promotions` | `agents.publish` | Request a promotion: `{agentId, version, fromEnvironment, toEnvironment}`. Non-adjacent hop (Development → Production) → `422 governance.promotion_path_invalid`. Runs the publish gate for the target environment and refuses with `409 agent.publish_gate_blocked` up front, rather than letting an approver discover the failure. | B14 tab 1 |
| `POST` | `/governance/promotions/{id}/approve` | `agents.publish` | **Approve.** `Idempotency-Key` required. In **one database transaction**: promotion → `approved`, the target environment's current version updated, and the audit entry written (§12 invariant 3). If the audit insert fails, the promotion does not happen — that is the guarantee behind B14's *"either action removes the item and writes an entry to the audit log in real time"*. Same requester and approver → `403 governance.promotion_self_approval`. Already resolved → `409 governance.promotion_already_resolved`. | B14 tab 1 `Approve` → tab 2 |
| `POST` | `/governance/promotions/{id}/reject` | `agents.publish` | **Reject** with `{reason}`. Same single-transaction audit guarantee. | B14 tab 1 `Reject` → tab 2 |

**Audit log (B14 tab 2).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/governance/audit-log` | `analytics.view` | Immutable entries: actor, action, target, environment, before/after, trace id, timestamp. **Cursor-paginated** — see §1.3 for why offset is unacceptable on an append-only record. Filters: `?actorId=&action=&environment=&targetType=&occurredAt.gte=&occurredAt.lte=&q=` | B14 tab 2 table |
| `GET` | `/governance/audit-log/{id}` | `analytics.view` | One entry with its full before/after diff | B14 tab 2 |
| `POST` | `/governance/audit-log/exports` | `analytics.view` | Export a filtered range. `202` + job. **The export itself is audited** — the log records reads of the log. | B14 tab 2 **[ASSUMPTION]** |

There is no `POST`, `PATCH`, `PUT` or `DELETE` on audit entries, for any role including Super Admin. The database user has `INSERT` and `SELECT` on that table and no `UPDATE` or `DELETE` grant ([`architecture.md`](./architecture.md) §10), so immutability is a permission the application does not hold rather than a rule it chooses to follow. A write attempt is `405 governance.audit_log_immutable`.

**Observability (B14 tab 3).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/governance/observability` | `dashboard.view` | *(proxy → `/v1/health/dependencies`, merged with web-tier metrics)* Per-service p95 latency, error rate and status, plus `remediation` pointing at the screen that handles it — which is how the summary strip says *"its circuit breaker is configured under Tools → Resilience & fallbacks"* | B14 tab 3 table + summary strip |
| `GET` | `/governance/observability/incidents` | `dashboard.view` | Open degradations with their breaker state and first-seen time. The SEWA bill API appears here, in B5 tab 4 as an open breaker, and in B14 tab 3 as Degraded — one incident, one source, three views. **[ASSUMPTION]** | B14 tab 3 ↔ B5 tab 4 |

**Privacy (B14 tab 4).**

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` \| `PUT` | `/governance/privacy` | `users.manage` | Consent ledger on/off, honour erasure requests on/off, transcript retention (`30d` \| `90d` \| `1y` \| `7y`), data residency (`uae_sharjah` \| `uae_dubai` \| `region_flexible`). `If-Match` required. **Changing residency returns `meta.warnings` naming every adapter that would violate it** — embeddings to OpenAI and rerank to Cohere transmit citizen text outside the UAE (RISK-001, [ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md)). The API surfaces the conflict rather than letting a setting quietly claim a guarantee the runtime does not honour. | B14 tab 4 settings |
| `GET` | `/governance/consent-ledger` | `users.manage` | Consent and opt-in history per subject, cursor-paginated. Subject lookup is by hashed identifier only. | B14 tab 4 consent ledger |
| `POST` | `/governance/erasure-requests` | `users.manage` | Right-to-be-forgotten request. `202` + job. Erases transcripts and derived memory; **transaction records are retained under the 7-year statutory carve-out** and the reference is pseudonymised instead. A request scoped to transaction data alone → `409 governance.erasure_conflicts_with_retention`, explaining the carve-out rather than half-completing. | B14 tab 4 erasure |
| `GET` | `/governance/erasure-requests` | `users.manage` | Request status and what was erased vs retained — the evidence a regulator asks for | B14 tab 4 **[ASSUMPTION]** |
| `GET` | `/governance/retention-preview` | `users.manage` | What lowering retention would delete, before it is applied. **[ASSUMPTION]** — retention changes are destructive and irreversible; a preview is the minimum. | B14 tab 4 |

**22 endpoints.**

### 6.13 `evaluation` — B13 Evaluation & testing

| Method | Path | Permission | Purpose | Wireframe control |
|---|---|---|---|---|
| `GET` | `/evaluation/golden-sets` | `agents.manage` | Sets with case count, owner and last score — Billing core journeys 48/94%, Customs enquiries 32/88%, Arabic language parity 60/**71%**, Guardrail red-team 25/100% | B13 tab 1 table |
| `POST` | `/evaluation/golden-sets` | `agents.manage` | Create a set: `{name, owner, description}` | B13 tab 1 **[ASSUMPTION]** |
| `GET` | `/evaluation/golden-sets/{id}` | `agents.manage` | Set detail with score history | B13 tab 1 |
| `PATCH` | `/evaluation/golden-sets/{id}` | `agents.manage` | Rename, reassign owner | B13 tab 1 **[ASSUMPTION]** |
| `DELETE` | `/evaluation/golden-sets/{id}` | `agents.manage` | Delete. Referenced by the publish gate → `409`; a gate pointing at a missing set would fail open, which is the one thing a gate must never do. | B13 tab 1 **[ASSUMPTION]** |
| `GET` | `/evaluation/golden-sets/{id}/cases` | `agents.manage` | Cases, cursor-paginated | B13 tab 1 `Edit cases` |
| `POST` | `/evaluation/golden-sets/{id}/cases` | `agents.manage` | Add a case — authored inline, or `{source:{conversationId}}` from a transcript. Idempotent per `(setId, conversationId)`: repeat → `409 evaluation.case_already_added`, which is what disables B1's button. Increments the set count in the same transaction. | B1 tab 2 `Add to golden set` → B13 tab 1 |
| `PATCH` | `/evaluation/golden-sets/{id}/cases/{caseId}` | `agents.manage` | Edit expected output, tags or weight | B13 tab 1 `Edit cases` |
| `DELETE` | `/evaluation/golden-sets/{id}/cases/{caseId}` | `agents.manage` | Remove a case | B13 tab 1 **[ASSUMPTION]** |
| `POST` | `/evaluation/golden-sets/{id}/runs` | `agents.manage` | *(proxy → `/v1/evaluation/runs`)* **Run now.** `Idempotency-Key` required; `202` + job. On completion the set's last score is updated, which is the live rescoring the wireframe shows. | B13 tab 1 `Run now` |
| `GET` | `/evaluation/runs` | `agents.manage` | Regression run history: agent, version, set, accuracy, groundedness, tool accuracy, result | B13 tab 2 table |
| `POST` | `/evaluation/runs` | `agents.manage` | *(proxy)* **Run all suites** — every set against every bound agent version. `Idempotency-Key` required; `202` + job; the completed run is prepended to the history. | B13 tab 2 `Run all suites` |
| `GET` | `/evaluation/runs/{id}` | `agents.manage` | *(proxy)* Run detail with aggregate scores | B13 tab 2 |
| `GET` | `/evaluation/runs/{id}/cases` | `agents.manage` | *(proxy)* Per-case results with a trace id each, so a failure is debuggable rather than merely red | B13 tab 2 **[ASSUMPTION]** |
| `GET` \| `PUT` | `/evaluation/publish-gate` | `agents.publish` | Block publish when a suite fails; minimum accuracy (85); minimum groundedness (80); red-team must score 100%; block publish when a bound locale is below 100% translated. `If-Match` required. **Turning the gate off is audited with an acknowledgement**, because it changes the summary strip to *"Any agent can be published regardless of test results."* | B13 tab 3 settings |
| `GET` | `/evaluation/publish-gate/evaluation?agentId=&version=` | `agents.manage` | **The live consequence.** Returns `{blocked, reasons:[{goldenSetId, goldenSetName, metric, score, threshold}]}` — which is what lets the strip say *"General FAQ Agent v3.0 is currently blocked — Arabic parity at 71% is below the 85% floor"*. The gate explains *why*, and the blocking set, its score and the missed threshold are all named in the payload rather than assembled from strings in the UI (B13 tab 3 rule). Called by the wizard's step 10, by B2's publish button and by the publish endpoint itself — one evaluator, three callers, no divergence. | B13 tab 3 summary strip |

**17 endpoints.**

### 6.14 `platform-admin` — the platform operator's own console

A genuinely different auth boundary from every other row in this section, added for the
platform-admin wave (2026-09-13). Every endpoint below requires the **compound**
`platform:operate` gate (`RequirePlatformOperator`, not `requirePermission` alone): (1) the
principal holds `platform:operate`, **and** (2) the principal's own tenant is the real
Platform tenant (`Tenant.entityKind = "PlatformOperator"`, seeded at slug `sharjah`).
`platform:operate` is deliberately absent from every tenant's seeded role matrix — granted
only to `sharjah`'s own Super Admin, by a one-off ops script — so condition (2) is the actual
security boundary; condition (1) alone is not (any tenant's own Super Admin can toggle any
matrix cell for their own tenant at runtime, B9 tab 3).

Prefix `/platform-admin`. Every write is audited (§12 invariant 3); cross-tenant writes
(the branding rows below) use `action: "tenant.branding.override"` and name the target
tenant explicitly in `PlatformAuditLogEntries`, distinct from that tenant's own
`AuditLogEntries`.

| Method | Path | Purpose | Wireframe control |
|---|---|---|---|
| `GET` | `/platform-admin/tenants` | List every tenant regardless of status (Provisioning, Active, Suspended, Deprovisioning, Deprovisioned, Failed). Read-only, unaudited (a listing is not a write). | Tenants screen table |
| `POST` | `/platform-admin/tenants` | Create a tenant. `{slug, displayName}`; embedding model/dimensions default from the same env vars `scripts/seed-iam-demo-data.ts` uses. Provisions all four stores (SQL/Neo4j/Qdrant/Redis) — reuses `ProvisionTenant` unchanged. | Tenants screen `Create tenant` |
| `POST` | `/platform-admin/tenants/{slug}/suspend` | Suspend an Active tenant. Three effects in one operation: status → `Suspended`; every one of that tenant's live staff sessions destroyed immediately (`TenantSessionRevoker`); every subsequent sign-in attempt or session re-check for that tenant refused (`ResolveSession`/`LocalPasswordProvider` both check tenant status, not just user status). Not-Active → `409`. | Tenants screen `Suspend` |
| `POST` | `/platform-admin/tenants/{slug}/deprovision` | **Permanently delete** a tenant. `{confirmSlug}` must exactly equal `slug` — a typed-confirmation gate enforced in the use case itself, not only the UI. Refuses unless the tenant is already `Suspended` (a mandatory two-step, cooling-off precondition) → `409`. Tears down all four stores in reverse creation order and verifies each is gone before flipping status to `Deprovisioned`; a store that fails to clean up leaves the tenant `Deprovisioning` (not `Deprovisioned`) and the response names which store and why. Irreversible — there is no soft-undo tier. | Tenants screen `Delete` |
| `GET` | `/platform-admin/branding?tenant={slug}` | Load a target tenant's full branding: active skin colours, branding scalars (app title, mode, density, font size, shadow depth, sidebar style), brand assets (logo light/dark, favicon), and the tenant's skin list. Rebinds to `slug` for the read (`platformScope: "branding-override"`); refuses an unknown slug. | Branding screen, on tenant selection |
| `PUT` | `/platform-admin/branding?tenant={slug}` | Save a target tenant's appearance — identical shape and contrast validation to `PUT /theming/branding` (§7.1), reusing `ManageAppearance`/`PrismaThemeRepository` completely unchanged. Attributed to the acting operator, not the tenant's own admin. | Branding screen `Save` |
| `POST` | `/platform-admin/branding/skins/{id}/activate?tenant={slug}` | Apply an existing skin (or the synthetic system-default entry) as the target tenant's active branding. | Branding screen `Apply` |
| `POST` | `/platform-admin/branding/skins/duplicate?tenant={slug}` | Duplicate a skin (including the system-default entry) into a new named tenant skin. | Branding screen `Duplicate` |
| `PATCH` | `/platform-admin/branding/skins/{id}?tenant={slug}` | Rename a skin / edit its description. | Branding screen `Rename` |
| `DELETE` | `/platform-admin/branding/skins/{id}?tenant={slug}` | Delete a tenant skin. | Branding screen `Delete` |
| `GET` | `/platform-admin/branding/skins/{id}/export?tenant={slug}&mode=light\|dark` | Export a skin as the JSON document §7.3 describes. | Branding screen `Export` |
| `POST` | `/platform-admin/branding/assets?tenant={slug}` | Upload a logo or favicon for the target tenant. `multipart`, same validation as `POST /theming/branding/assets` (§7.1). | Branding screen brand-asset upload |
| `POST` | `/platform-admin/branding/skins/import/validate` | Parse and validate an uploaded skin file for one mode, returning the resolved colours without persisting anything — no target tenant, pure validation. | Branding screen `Import` |
| `GET` \| `PUT` | `/platform-admin/me/theme` | The signed-in **operator's own** personal appearance preference — mode/density/direction/font-size/reduced-motion and personal skin choice. Deliberately **never** rebound to whichever tenant is selected in the picker: this is the operator's own account, identical in effect to `GET`/`PUT /theming/me` (§7.1) for any ordinary staff member. | Branding screen personal-preference controls |
| `POST` | `/platform-admin/branding/reset?tenant={slug}` | Reset the target tenant's branding to the system default — deletes its saved branding entirely, same effect as `DELETE /theming/branding` for that tenant's own admin. | Branding → Reset screen, tenant section |
| `POST` | `/platform-admin/me/theme/reset` | Reset the operator's own personal preference. Ambient (operator's own tenant), never the tenant selected in the picker. | Branding → Reset screen, personal section |

**16 endpoints.**

**Backoffice API: 227 endpoints across 13 module subsections**, plus the 8 session and TOTP
endpoints in §3.2, plus §6.14's 16 platform-admin endpoints (a distinct auth boundary, kept
out of that running total on purpose — it is not reachable by any tenant's own staff,
regardless of permissions).

---

## 7. Theming API

`theming` module, [ADR-0007](./adr/0007-design-system-and-runtime-theming.md), Phase E. Tokens resolve at **runtime** as CSS custom properties — changing a token repaints the whole app with no rebuild and no redeploy. The API therefore serves values, never compiled CSS, and there is no endpoint that returns a stylesheet.

Prefix `/api/backoffice/theming` for authoring, `/api/public/v1/theme` for the widget (§4.2), `/api/backoffice/me/theme` for the signed-in user's own preference.

### 7.1 The token set

A token set is a flat map of registry-declared token names to values. The registry is the contract: a token that is not in it cannot be written, which is what stops an imported skin from smuggling arbitrary CSS.

| Group | Tokens |
|---|---|
| Brand | `color.brand.primary`, `.secondary`, `.accent` |
| Semantic | `color.semantic.success`, `.warning`, `.danger`, `.info` |
| Surface | `color.surface.paper`, `.panel`, `.raised`, `color.text.primary`, `.muted`, `.inverse`, `color.border.subtle`, `.strong` |
| Typography | `font.family.sans`, `.mono`, `font.size.base`, `font.scale.ratio`, `font.weight.regular`, `.medium`, `.bold` |
| Layout | `radius.sm\|md\|lg\|full`, `space.density` (`compact` \| `comfortable`), `shadow.depth` (`none` \| `subtle` \| `elevated`), `sidebar.style` (`solid` \| `translucent`) |
| Mode | `mode` (`light` \| `dark` \| `system`) |
| Direction | `direction` (`ltr` \| `rtl`) — bound to locale selection (B10 tab 5), not set independently |
| Assets | `asset.logo.light`, `.dark`, `asset.favicon`, `text.appTitle` |

| Method | Path | Permission | Purpose | Wireframe / phase |
|---|---|---|---|---|
| `GET` | `/theming/tokens` | `dashboard.view` | The token **registry**: every token name, its type (`color` \| `length` \| `enum` \| `asset` \| `text`), allowed values, default, group, and which surfaces it repaints. The Appearance screen builds its form from this, so adding a token never requires a UI change. | Phase E |
| `GET` | `/theming/tokens/values?scope=system\|tenant\|user` | `dashboard.view` | The raw values held at one scope, unmerged, with `null` for tokens that scope does not set. Unmerged is the point: an editor must see what *this* scope overrides versus what it inherits. | Phase E |
| `PUT` | `/theming/tokens/values?scope=tenant` | `users.manage` | Write tenant-scope values. `If-Match` required. Validated against the registry **and** the contrast rules (§7.4). `scope=system` is refused for every principal — the system default ships with the build and is not editable at runtime (`403 authz.permission_denied`, `meta.reason: "system_scope_immutable"`). **[ASSUMPTION]** on the permission: B9 has no theming row, and tenant branding is what every citizen sees, so it takes `users.manage`. | Phase E, tenant branding |

### 7.2 Skins

A skin is a named, saveable preset of token values — the unit users duplicate, edit, export and import. Two ship with the product: `default` and `dark`. Both are system skins: immutable, undeletable, and always available as the target of a one-click restore.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/theming/skins` | `dashboard.view` | List skins with `origin` (`system` \| `tenant` \| `user`), `isActive`, author and last-modified. Cursor-paginated. |
| `POST` | `/theming/skins` | `users.manage` | Create a skin from a token-value map. Name unique per tenant → `409 theming.skin_name_taken`. Full validation (§7.4) before it is stored — an invalid skin is never persisted "as a draft". |
| `GET` | `/theming/skins/{id}` | `dashboard.view` | One skin with its values and its inheritance chain |
| `PUT` | `/theming/skins/{id}` | `users.manage` | Replace a skin's values. `If-Match` required. System skin → `409 theming.skin_immutable`. Editing the **active** skin repaints every live session on their next token fetch; the response carries `meta.affectedScope` so the UI can warn before saving. |
| `PATCH` | `/theming/skins/{id}` | `users.manage` | Rename or edit the description only. Values go through `PUT`, so a rename can never partially apply a value change. |
| `DELETE` | `/theming/skins/{id}` | `users.manage` | Delete. System skin → `409 theming.skin_immutable`. Currently active at tenant scope → `409`, with the instruction to activate another first; deleting the active skin would leave the tenant with no resolvable branding. |
| `POST` | `/theming/skins/{id}/duplicate` | `users.manage` | **Duplicate.** Copies values into a new `tenant`-origin skin named `<name> (copy)`, inactive. This is how a system skin becomes editable — the wireframe's "duplicate, edit" path — without ever mutating `default` or `dark`. |
| `POST` | `/theming/skins/{id}/activate` | `users.manage` | Activate at tenant scope. In one transaction: previous active deactivated, this one activated, audit entry written (§12 invariant 3). Idempotent. |
| `POST` | `/theming/skins/{id}/preview-token` | `dashboard.view` | Mint a short-lived (5-minute), single-skin preview token. **Live preview** applies the skin to the previewing session only, without saving — so the explicit Save / Reset to default is a real choice and the app is never left half-applied. The token is scoped to the previewing session id and cannot be shared. |
| `GET` | `/theming/skins/{id}/export` | `dashboard.view` | **Export as JSON.** `Content-Disposition: attachment`. Body is the skin document of §7.3. Assets are exported as content-addressed references plus their bytes base64-inlined when under 256 KiB, otherwise as reference-only with a `meta.warning` — an export that silently loses a logo is worse than one that says so. |
| `POST` | `/theming/skins/import` | `users.manage` | **Import.** Untrusted input; see §7.4. `201` with the created skin, **inactive**, or `422` with every violation. Never partially applied. |
| `POST` | `/theming/skins/import/validate` | `dashboard.view` | Dry-run the same validation and return the findings without creating anything. Lets the UI show what is wrong with a file before the user commits to importing it. |
| `GET` | `/theming/branding` | `dashboard.view` | Tenant branding: active skin, logo light/dark, favicon, app title |
| `PUT` | `/theming/branding` | `users.manage` | Set tenant branding. `If-Match` required. Audited. |
| `POST` | `/theming/branding/assets` | `users.manage` | Upload a logo or favicon. `multipart`. PNG/SVG/WebP only, ≤ 512 KiB, and **SVG is sanitised**: `<script>`, `<foreignObject>`, event attributes and external references are stripped, and the file is re-serialised from the parsed tree rather than pattern-scrubbed. Anything else → `422 theming.asset_invalid`. Returns a content-addressed URL. An uploaded logo is served from a separate asset origin with `Content-Security-Policy: sandbox`, because a tenant admin uploading an image must not become a stored-XSS vector in a government portal. |
| `DELETE` | `/theming/branding/assets/{id}` | `users.manage` | Remove an asset. Referenced by any skin → `409`. |
| `GET` | `/theming/me` | *session only* | The signed-in user's own preference — chosen skin, mode override, density override |
| `PUT` | `/theming/me` | *session only* | Set it. No permission is required: a user changing their own appearance is not an authorization decision. Validated against the registry and contrast rules like any other write; a user cannot give themselves an unreadable interface. |
| `DELETE` | `/theming/me` | *session only* | Clear the user's preference, falling back to tenant then system. This is the per-user "Reset to default". |

**19 endpoints**, plus the 3 token-registry endpoints in §7.1 and the 2 resolution endpoints in §7.3 — **24** for the module.

### 7.3 Resolution — user → tenant → system default

One endpoint returns what the app actually paints. Everything else is authoring.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `GET` | `/theming/resolved` | *session only* | Merged token set for the current principal, with provenance |
| `GET` | `/api/public/v1/theme?channelKey=…` | none | Merged token set for the widget: tenant → system only, since a citizen has no stored preference. `ETag`, 60 s cache (§4.2). |

```json
{
  "resolvedAt": "2026-09-08T09:12:33.481Z",
  "tokens": {
    "color.brand.primary": "#1F6F5C",
    "color.surface.paper": "#F6F5F1",
    "color.text.primary": "#20242B",
    "radius.md": "6px",
    "space.density": "comfortable",
    "mode": "dark",
    "direction": "ltr",
    "asset.logo.light": "https://assets.shj3.gov.ae/t/sewa/logo-light-9f2a1c.svg"
  },
  "provenance": {
    "color.brand.primary": "tenant",
    "color.surface.paper": "system",
    "mode": "user",
    "direction": "locale"
  },
  "activeSkin": { "id": "skn_sewa_dark", "name": "SEWA Dark", "origin": "tenant" },
  "etag": "W/\"tok-7d3f21\""
}
```

Resolution rules:

1. **Order is user preference → tenant/organisation theme → system default**, per token, not per skin. A user who overrode only `mode` inherits every other token from the tenant; a tenant that overrode only `color.brand.primary` inherits the rest from the system default. Merging whole skins instead of individual tokens would make a one-token user preference discard the tenant's entire branding.
2. **The set is always complete.** Every registry token has a value in the response, because the system default is total. A client never has to handle a missing token, and a null can never reach CSS.
3. `provenance` names the winning scope per token. It is what lets the Appearance screen show "inherited from SEWA" beside a control instead of pretending the value was set locally.
4. `direction` resolves from the locale (B10 tab 5), so its provenance is `locale` and it is not user-writable. RTL follows language; decoupling them produces mirrored English.
5. **Tenant isolation is absolute here.** The tenant comes from the principal (§12 invariant 1). A tenant can never see another tenant's branding — including through a forged `channelKey`, which resolves to exactly one channel in exactly one tenant or `404`.
6. `ETag` is a hash of the merged set. The app revalidates with `If-None-Match` and takes `304` for free most of the time; a token change invalidates it, so a repaint is at most one request behind a save.

### 7.4 Import is untrusted input

A skin JSON file arrives from a person's disk. It is validated in full, in this order, and **rejected rather than partially applied**. There is no path by which a half-valid import lands some tokens and skips others.

```json
{
  "$schema": "https://api.shj3.gov.ae/schemas/skin/v1.json",
  "schemaVersion": 1,
  "name": "SEWA Dark",
  "description": "Dark skin for SEWA billing operations",
  "mode": "dark",
  "tokens": {
    "color.brand.primary": "#2E9E82",
    "color.surface.paper": "#14171C",
    "color.text.primary": "#EDEFF2",
    "radius.md": "6px",
    "space.density": "comfortable"
  },
  "assets": {
    "asset.logo.dark": { "contentType": "image/svg+xml", "sha256": "9f2a…", "data": "PHN2Zy…" }
  }
}
```

| # | Gate | Failure |
|---|---|---|
| 1 | Size and shape — ≤ 256 KiB, parseable JSON, object at the root | `413` / `400 request.malformed_body` |
| 2 | `schemaVersion` known. A newer version than this build understands is refused, not best-guessed | `422 theming.schema_invalid` |
| 3 | JSON Schema validation of the whole document, including unknown-key rejection at every level | `422 theming.schema_invalid`, one `errors[]` entry per pointer |
| 4 | **Every token name exists in the registry.** An unknown token is a rejection, not an ignore — an ignored token is how an import appears to succeed and does nothing | `422 theming.unknown_token`, listing each |
| 5 | **Every value matches its token's type and constraint set.** Colors must parse as hex/`rgb()`/`hsl()` — no `var()`, no `url()`, no `calc()`, no `!important`, no CSS at all. Lengths are a number plus an allow-listed unit. Enums must be members. This is what keeps a runtime token system from becoming CSS injection | `422 validation.failed` with `format.invalid` / `enum.invalid` per pointer |
| 6 | Assets: declared `contentType` in the allow-list, `sha256` matches the decoded bytes, SVG sanitised as in §7.2, dimensions within bounds | `422 theming.asset_invalid` |
| 7 | **WCAG 2.1 AA contrast**, computed on the fully merged set — the import merged over tenant and system, not the fragment in isolation. A skin that only sets `color.text.primary` still has its contrast checked against the inherited background, because that is the pair a user will actually read | `422 theming.contrast_violation` |
| 8 | Name uniqueness within the tenant | `409 theming.skin_name_taken` |

Contrast is checked for every declared foreground/background pair in the registry — body text on paper, body text on panel, muted text on paper, inverse text on brand primary, brand primary as a link on paper, semantic colors on their own surfaces, and focus ring against both adjacent surfaces. Thresholds are 4.5:1 for normal text, 3:1 for large text and for non-text UI components (WCAG 1.4.3 and 1.4.11). Both light and dark resolutions of the merged set are checked when `mode: "system"`, since either may be what a viewer sees.

```json
{
  "type": "https://api.shj3.gov.ae/problems/theming.contrast_violation",
  "title": "Contrast requirements not met",
  "status": 422,
  "code": "theming.contrast_violation",
  "detail": "3 token pairs fail WCAG 2.1 AA.",
  "errors": [
    { "pointer": "/tokens/color.text.muted", "code": "value.conflict",
      "detail": "Muted text on panel is 3.1:1; 4.5:1 required for normal text.",
      "meta": { "foreground": "#8A8F98", "background": "#14171C", "ratio": 3.1, "required": 4.5,
                "criterion": "1.4.3", "inheritedBackgroundFrom": "tenant" } },
    { "pointer": "/tokens/color.brand.primary", "code": "value.conflict",
      "detail": "Inverse text on brand primary is 2.8:1; 4.5:1 required.",
      "meta": { "foreground": "#EDEFF2", "background": "#2E9E82", "ratio": 2.8, "required": 4.5,
                "criterion": "1.4.3" } },
    { "pointer": "/tokens/color.semantic.warning", "code": "value.conflict",
      "detail": "Warning indicator on paper is 2.4:1; 3:1 required for non-text UI.",
      "meta": { "ratio": 2.4, "required": 3.0, "criterion": "1.4.11" } }
  ]
}
```

Same validation applies to `PUT /theming/skins/{id}`, `PUT /theming/tokens/values`, `PUT /theming/me` and B10 tab 2's widget accent colour — one validator, five callers. The wireframe's requirement is to *warn before saving* and keep a one-click restore: the warn is `POST /theming/skins/import/validate` and the inline validate-on-change response; the **save itself refuses** rather than warning-and-proceeding, because a government portal that has been made unreadable is an accessibility incident, not a preference. The one-click restore is `POST /theming/skins/default/activate` for a tenant and `DELETE /theming/me` for a user, and neither can fail — `default` is a system skin and therefore always present and always valid.

Enforcement outside the API, stated because it is what keeps the system skinnable: any component that hardcodes a color, radius, spacing or font instead of consuming a token fails review, and a Tailwind lint rule fails the build on arbitrary values ([`architecture.md`](./architecture.md) §9). An API that serves tokens to a UI that ignores them would be theatre.

---

## 8. User guide API

`userguide` module, Phase F. The guide is a module inside the application, reachable from a persistent Help icon — not an external PDF. It is searchable, deep-linkable, i18n-ready (EN/AR) and versioned with the app.

Reads sit under `/api/backoffice/userguide` and require only a valid session, no B9 permission: a user must be able to read the guide for a screen they are about to be granted access to, and gating help behind the permission it explains is circular. Content is nonetheless **filtered by permission** — see rule 4 below.

| Method | Path | Permission | Purpose | Phase F requirement |
|---|---|---|---|---|
| `GET` | `/userguide/tree?locale=en` | *session only* | **Navigation tree** — module → submodule → page, mirroring the real app navigation, with each node's entry slug, title, and whether the current principal can reach the page it documents. Built from the same route manifest that builds the app sidebar, so the two cannot drift. `ETag`, cached until the next deploy. | Side menu listing every module → submodule → page |
| `GET` | `/userguide/entries/{slug}?locale=en` | *session only* | **One entry per page in the system**: purpose in plain language, a walkthrough of every feature, button, filter and field, step-by-step how-tos for the main tasks, permission notes, screenshot references, and links to related entries. Returns structured blocks, not a rendered HTML string, so the client renders with app components and RTL comes for free. | One entry per page |
| `GET` | `/userguide/entries/{slug}/screenshots/{shotId}` | *session only* | **Screenshot asset.** Content-addressed, immutable URL (`…/{shotId}` includes the content hash), `Cache-Control: public, max-age=31536000, immutable`. Served from the asset origin with a sandbox CSP. Locale-specific variants where the UI differs (RTL layout, Arabic labels). | Screenshot of the page, kept current |
| `GET` | `/userguide/search?q=…&locale=en&scope=…` | *session only* | Full-text search across titles, purpose text, walkthrough bodies and field labels. Returns ranked hits with the matched snippet, the entry slug, its position in the tree, and an anchor into the block that matched. Results are permission-filtered (rule 4). Cursor-paginated. | Searchable |
| `GET` | `/userguide/resolve?appPath=/backoffice/handover&tab=routing-rules&anchor=rule-tester` | *session only* | **Deep-link resolution, app → guide.** Maps a real application location to its guide entry and the specific block inside it. This is what the Help icon calls: it is context-aware because the caller passes where the user is standing. No entry → `404 userguide.deep_link_unresolvable`, and the response names the nearest ancestor entry so Help opens *somewhere* useful rather than empty. | Deep-linkable |
| `GET` | `/userguide/entries/{slug}/links` | *session only* | Reverse resolution, guide → app: the concrete in-app URLs an entry documents, so "Open this screen" works from inside the guide. **[ASSUMPTION]** | Deep-linkable |
| `GET` | `/userguide/coverage` | `agents.manage` | Every app route with its entry status: `documented`, `missing`, `stale` (screenshot or body older than the route's last change), plus translation coverage per locale. This is the endpoint CI reads to enforce the maintenance rule. | Maintenance rule |
| `PUT` | `/userguide/entries/{slug}` | `agents.manage` | Author or update an entry. Validated against the entry schema: purpose non-empty, at least one how-to step, every documented control resolving to a known control id for that route, and a screenshot reference present. Publishing an entry with no current screenshot → `409 userguide.screenshot_missing`. **[ASSUMPTION]** on the permission — B9 has no documentation row, and guide content is authored alongside the feature it describes. | Versioned with the app |
| `POST` | `/userguide/entries/{slug}/screenshots` | `agents.manage` | Upload a screenshot. `multipart`, PNG/WebP, ≤ 2 MiB. Returns the content-addressed `shotId`. Stamped with the app version and the locale it was captured in, which is how `stale` in `/coverage` is computed rather than guessed. | Kept current with the UI |
| `DELETE` | `/userguide/entries/{slug}/screenshots/{shotId}` | `agents.manage` | Remove a screenshot. Last one on a published entry → `409 userguide.screenshot_missing`. **[ASSUMPTION]** | — |

**10 endpoints.**

Rules:

1. **Entries are content-addressed by app route, not by hand-written slug.** The slug is derived from the route (`backoffice.handover.routing-rules`), so an entry cannot exist for a page that does not exist, and a page cannot quietly lose its entry when it is renamed — the rename shows up in `/userguide/coverage` as `missing`.
2. **Versioned with the app.** Entries and screenshots carry the app version they describe. The guide served to a user is the guide for the running build; there is no separate publishing cycle to fall behind. Historic versions are retained so a UAT user reading the UAT build sees the UAT guide.
3. **i18n-ready.** `locale` is a query parameter on every read, EN and AR. A missing translation falls back to the fallback locale (B10 tab 5) and the response sets `meta.fallbackApplied: true` — a silent English page inside an Arabic app is the failure the locale gate exists to prevent (B13 tab 3).
4. **Permission-aware content, not permission-gated access.** Every entry block may declare `requiredPermission`. Blocks the principal cannot exercise are returned but flagged `available: false` with the permission named — this is exactly the *"notes on permissions/roles that change what the user sees"* requirement, and it turns a mystery into "ask an Entity Admin". Search never returns a snippet from a block the caller cannot see the screen for, because a search result is a leak of the screen's existence and content in a way a permission note is not.
5. **The maintenance rule is enforced in CI, through this API.** A PR that adds or changes a route must add or update its entry and screenshot in the same PR; `GET /userguide/coverage` returning any `missing` or `stale` row for a changed route fails the check. A page with no guide entry fails review — and because the check reads the API rather than a file listing, it cannot be satisfied by an empty stub: the entry schema requires purpose text, a how-to and a screenshot.

---

## 9. Ports — the vendor-facing contracts

This section is the proof that the business logic is framework-, database-, cloud- and vendor-agnostic. Twelve ports. `domain/` and `application/` depend on these interfaces and on nothing else; `adapters/outbound/` is the only layer permitted to import a vendor SDK ([`architecture.md`](./architecture.md) §4, [ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 1).

**The swap test.** Grep `domain/` and `application/` in both runtimes for `litellm`, `openai`, `cohere`, `google.adk`, `neo4j`, `qdrant_client`, `@prisma/client`, `ioredis`, `redis`, `next/`, `fastapi`, `stripe`, `argon2`. The result must be empty. It runs in pre-commit and it is the only meaningful enforcement of this section — a documented port with a leaked SDK import is not a port.

Ownership and runtime:

| Port | Runtime | Module | Current adapter |
|---|---|---|---|
| `ChatModel` | ai | orchestration | `LiteLlmOpenRouterChatModel` |
| `EmbeddingProvider` | ai | knowledge | `OpenAiEmbeddingProvider` |
| `Reranker` | ai | knowledge | `CohereReranker` |
| `GraphStore` | ai | knowledge | `Neo4jGraphStore` |
| `VectorStore` | ai | knowledge | `QdrantVectorStore` |
| `SourceRepository` | ai | knowledge | `SqlAlchemySourceRepository` |
| `CacheStore` | both | platform | `RedisCacheStore` / `RedisCacheStoreTs` |
| `IdentityProvider` | web | iam | `LocalPasswordProvider` |
| `VerificationProvider` | web | verification | `MockVerificationProvider` |
| `PaymentGateway` | web | payments | `SharjahPayGateway` |
| `ChannelTransport` | web | channels | `MetaCloudWhatsAppTransport`, `WebWidgetTransport` |
| `McpClient` | ai | tools | `McpSdkClient` |

### 9.1 `ChatModel`

**Purpose.** Every model call in the system. The domain asks for a completion; it never learns which vendor answered, which is what makes B3 step 3's per-agent primary/fallback selection configuration rather than code ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 2).

```python
class ChatModel(Protocol):
    """A conversational completion, streamed or whole. No vendor concept crosses this line."""

    async def complete(self, request: ChatRequest) -> ChatCompletion:
        """One-shot completion. Raises ModelUnavailable | ModelTimeout | ModelRefused."""

    def stream(self, request: ChatRequest) -> AsyncIterator[ChatDelta]:
        """Token stream. Yields ChatDelta(text=…) and ChatDelta(tool_call=…) in real order.
        Terminates with ChatDelta(finish_reason=…) or raises."""

    async def count_tokens(self, messages: Sequence[Message], model: ModelId) -> int:
        """Pre-flight accounting so B4's cost ceiling is enforced before spend, not after."""

    def capabilities(self, model: ModelId) -> ModelCapabilities:
        """context_window, supports_tools, supports_streaming, cost_per_1k_in/out.
        Read from configuration, never probed at request time."""
```

`ChatRequest` carries `model: ModelId`, `fallback_model: ModelId | None`, `temperature`, `messages`, `tools: Sequence[ToolDescriptor]`, `max_output_tokens`, `deadline_ms`, and `accounting: AccountingContext` (tenant, agent, conversation — every call records tokens and cost against all three, [ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 5). `ModelId` is an opaque string from configuration; the domain never branches on its value.

Fallback lives **in the adapter**, not in the use case: primary error or timeout → retry once on `fallback_model`, record `degraded: ["primary_model_failed"]`, and only then raise `ModelUnavailable`. Putting fallback in the domain would mean every use case reimplementing it, and B3's fallback model has its own test ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 4) — an untested fallback is not a fallback.

**Swap cost: low.** OpenRouter → Bedrock, Vertex or direct Anthropic is one adapter (~200 lines) plus configuration. Zero domain files, zero migrations. The B13 regression suites then become the model-selection tool they were designed to be.

### 9.2 `EmbeddingProvider`

**Purpose.** Text → vector, for ingestion and for query embedding.

```python
class EmbeddingProvider(Protocol):
    async def embed_documents(self, texts: Sequence[str], model: EmbeddingModelId) -> list[Vector]: ...
    async def embed_query(self, text: str, model: EmbeddingModelId) -> Vector: ...
    def dimensions(self, model: EmbeddingModelId) -> int: ...
    def max_input_tokens(self, model: EmbeddingModelId) -> int: ...
```

Separate document and query methods because some models use asymmetric prefixes; the domain must not be the place that remembers to add one. `dimensions()` is what lets the knowledge module refuse a mismatched collection at query time (`409 knowledge.embedding_model_mismatch`, §5.4 rule 4) rather than silently degrading retrieval.

**Current adapter:** `OpenAiEmbeddingProvider`, `text-embedding-3-large`, 3072-dim.

**Swap cost: low in code, high in data.** The adapter is trivial. But changing the model is a **full re-index**, never a partial one ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 3), so the operational cost is a re-index window per tenant. This is the port that RISK-001 turns on: swapping to self-hosted BGE-M3 to satisfy the *UAE — Sharjah data centre* residency default (B14 tab 4) is one adapter plus one re-index, which is exactly why the abstraction is worth its indirection.

### 9.3 `Reranker`

**Purpose.** Reorder fused retrieval candidates by relevance to the query.

```python
class Reranker(Protocol):
    async def rerank(self, query: str, candidates: Sequence[Passage],
                     top_n: int, model: RerankModelId) -> list[RankedPassage]:
        """Returns candidates reordered with a rerank score.
        MUST NOT raise on provider failure — see RerankOutcome."""
```

The contract is unusual and deliberately so: **this port degrades, it never fails.** The adapter catches every provider error and returns the input order with `reranked=False`, and the caller records `degraded: ["reranker_unavailable"]` ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 6). A rerank outage must not fail a citizen conversation, so the interface does not offer the caller a way to fail.

**Current adapter:** `CohereReranker`, `rerank-v3.5`.

**Swap cost: very low.** Cohere → `bge-reranker-v2-m3` self-hosted, or off entirely (B6 tab 3's toggle). Nothing downstream changes because the caller already handles the unreranked path on every request.

### 9.4 `GraphStore`

**Purpose.** The knowledge graph — entities, relationships, traversal. Neo4j, abstracted. `shj3-web` has no access to this port at all ([ADR-0001](./adr/0001-modular-monolith-across-two-runtimes.md) constraint 2).

```python
class GraphStore(Protocol):
    async def upsert_nodes(self, nodes: Sequence[GraphNode]) -> None: ...
    async def upsert_edges(self, edges: Sequence[GraphEdge]) -> None: ...
    async def get_node(self, node_id: NodeId) -> GraphNode | None: ...
    async def delete_node(self, node_id: NodeId, cascade_edges: bool = True) -> None: ...
    async def search_entities(self, term: str, types: Sequence[EntityType] | None,
                              limit: int) -> list[GraphNode]: ...
    async def neighbourhood(self, root: NodeId, depth: int,
                            types: Sequence[EntityType] | None, limit: int) -> Subgraph: ...
    async def traverse(self, seeds: Sequence[NodeId], spec: TraversalSpec) -> list[ScoredPath]: ...
    async def find_duplicates(self, threshold: float) -> list[DuplicateCandidate]: ...
    async def merge_nodes(self, survivor: NodeId, absorbed: NodeId) -> MergeRecord: ...
    async def add_source_contribution(self, node_id: NodeId, source_id: SourceId) -> None: ...
```

No Cypher crosses this boundary. `TraversalSpec` is a domain value object — relationship types, direction, max depth, scoring — and the adapter compiles it to Cypher. `merge_nodes` returns a reversible `MergeRecord`, which is what makes B6 tab 2's Merge safe to click. The tenant is never a parameter: the adapter opens its session against the tenant database resolved from the request `contextvar` ([`architecture.md`](./architecture.md) §5), so a use case cannot express a cross-tenant traversal.

**Swap cost: medium.** Neo4j → Memgraph is near-free (same query language). Neo4j → a relational adjacency model or Amazon Neptune means reimplementing `traverse` and `find_duplicates` — perhaps 600–900 lines, with a real risk of losing traversal performance. Contained to one file; not free.

### 9.5 `VectorStore`

**Purpose.** Chunk embeddings and similarity search. Qdrant, abstracted.

```python
class VectorStore(Protocol):
    async def ensure_collection(self, spec: CollectionSpec) -> None:
        """Idempotent. Records the embedding model and dimension that own the collection."""
    async def upsert(self, chunks: Sequence[EmbeddedChunk]) -> None: ...
    async def search(self, vector: Vector, top_k: int,
                     filter: ChunkFilter | None) -> list[ScoredChunk]: ...
    async def delete_by_source(self, source_id: SourceId) -> int: ...
    async def collection_info(self, name: CollectionName) -> CollectionInfo:
        """embedding_model, dimensions, vector_count — the mismatch guard of §5.4."""
```

`ChunkFilter` is a domain object (source ids, locale, freshness), never a Qdrant filter expression, and never a string — a filter DSL that accepted strings would be an injection surface reachable from `?q=`. Collection names are **derived from the tenant**, not passed in (§5, `{tenant}_knowledge`).

**Swap cost: low.** Qdrant → pgvector, Weaviate or Milvus is one adapter plus a re-index to populate the new store. The interface is small on purpose: five operations is the entire vector surface the domain needs, and keeping it that small is what makes the swap credible rather than aspirational.

### 9.6 `SourceRepository`

**Purpose.** Persistence for knowledge `Source` aggregates — the SQL Server side of B6 tab 1. Named as a repository rather than a "database port" because the domain thinks in aggregates, not tables.

```python
class SourceRepository(Protocol):
    async def get(self, source_id: SourceId) -> Source | None: ...
    async def list(self, query: SourceQuery) -> Page[Source]: ...
    async def save(self, source: Source) -> None:
        """Full aggregate write. Optimistic concurrency on Source.version."""
    async def delete(self, source_id: SourceId) -> None: ...
    async def record_index_progress(self, source_id: SourceId, progress: IndexProgress) -> None: ...
    async def list_due_for_crawl(self, at: datetime) -> list[Source]:
        """Schedule-driven crawling — B6 tab 1's Manual / Daily / Weekly."""
```

`Page[Source]` carries the opaque cursor of §1.3, so pagination is a repository concern and no use case builds a keyset predicate. No ORM entity escapes: `Source` is a domain entity, and the SQLAlchemy model — **generated** from the Prisma schema, never hand-written ([ADR-0005](./adr/0005-prisma-owns-schema-sqlalchemy-reads.md)) — lives only inside the adapter.

**Swap cost: low.** SQL Server → PostgreSQL is a Prisma provider change, a regenerated SQLAlchemy model and a migration. Nothing in `domain/` or `application/` knows which engine answered. The same pattern repeats per aggregate — `AgentRepository`, `TransactionRepository`, `AuditLogRepository` — with identical shape; they are not enumerated here because they add no new vendor contract.

### 9.7 `CacheStore`

**Purpose.** The only ephemeral-state contract: sessions, breaker state, rate-limit counters, the campaign queue, idempotency records, SSE replay buffers. Redis, abstracted — and the reason **the raw client is not exported** ([`architecture.md`](./architecture.md) §5).

```typescript
/** Every key is tenant-prefixed by the implementation. There is no unprefixed handle. */
export interface CacheStore {
  get<T>(key: CacheKey): Promise<T | null>;
  set<T>(key: CacheKey, value: T, ttl: Duration): Promise<void>;
  /** Atomic claim. Returns false if the key already exists — the primitive behind
   *  idempotency keys (§1.5), webhook replay defence (§10.1) and ticket claiming (§6.8). */
  setIfAbsent<T>(key: CacheKey, value: T, ttl: Duration): Promise<boolean>;
  delete(key: CacheKey): Promise<void>;
  deleteByPrefix(prefix: CacheKeyPrefix): Promise<number>;
  /** Atomic counter with expiry — the rate limiter (§11) and the OTP attempt counter. */
  increment(key: CacheKey, by: number, ttl: Duration): Promise<number>;
  /** Compare-and-set, for breaker state transitions that must not race across replicas. */
  compareAndSet<T>(key: CacheKey, expected: T | null, next: T, ttl: Duration): Promise<boolean>;
  addToSet(key: CacheKey, member: string, ttl: Duration): Promise<void>;
  members(key: CacheKey): Promise<string[]>;
}
```

`CacheKey` is a branded type built only by `cacheKey(namespace, ...parts)`, which prepends the tenant from request scope. A plain string is not assignable to it, so a developer **cannot** write an unprefixed key — tenant isolation in Redis is a property of the type system, not of a naming convention people remember.

**Swap cost: low for the interface, medium in behaviour.** Redis → Valkey is a drop-in. Redis → Memcached loses `compareAndSet` and set operations, so breaker transitions and the per-user session index would need redesign. Redis → DynamoDB is possible but the latency profile changes what is reasonable to put behind it.

### 9.8 `IdentityProvider`

**Purpose.** Establish a staff `Principal`. [ADR-0006](./adr/0006-identity-behind-a-port.md). This is the port that makes "local auth now, SSO later" a configuration change instead of a rewrite.

```typescript
export interface IdentityProvider {
  /** Verify credentials. Returns a Principal or a challenge — never a token, hash or claim. */
  authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome>;
  /** Second factor. Separate operation so an OIDC adapter can return `not_applicable`
   *  when the IdP already performed MFA. */
  completeChallenge(challengeId: ChallengeId, response: ChallengeResponse): Promise<AuthenticationOutcome>;
  /** Map provider identity → Principal on every request. For OIDC this reads group claims;
   *  for local it reads the user record. Feature code sees only the result. */
  resolvePrincipal(subject: SubjectRef): Promise<Principal | null>;
  capabilities(): IdentityCapabilities; // supportsSelfServicePasswordChange, supportsEnrolment, mfaOwnedByProvider
}

export type AuthenticationOutcome =
  | { kind: 'authenticated'; principal: Principal }
  | { kind: 'challenge_required'; challengeId: ChallengeId; method: 'totp'; expiresAt: string }
  | { kind: 'enrolment_required'; enrolmentToken: EnrolmentToken }
  | { kind: 'rejected'; reason: 'invalid_credentials' | 'locked' };  // one reason for all three
  // ↑ 'invalid_credentials' deliberately covers unknown email, wrong password and
  //   non-active account, so the port itself cannot leak an enumeration oracle (§2.2).
```

Sessions are **not** this port's business: `authenticate` returns a `Principal`, and the session module mints an opaque Redis session from it ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 2). That separation is why OIDC arrival changes only session *creation*. The `User` record has no `password_hash`; `LocalCredential` is owned solely by the local adapter (rule 3), so SSO arrival drops one table and restructures none.

**Current adapter:** `LocalPasswordProvider` — Argon2id, mandatory TOTP for roles holding `agents.publish` or `users.manage`, progressive backoff, lockout, forced rotation on invite acceptance (rule 4).

**Swap cost: low, and this is the port's whole justification.** `OidcProvider` for Entra ID or Keycloak is one adapter, one config change and one dropped table. `capabilities()` is what lets the UI hide the password-change screen when the IdP owns credentials, without a feature module ever asking "are we on SSO?".

### 9.9 `VerificationProvider`

**Purpose.** Raise a citizen's assurance level before money moves. B11 tabs 1–2. [ADR-0006](./adr/0006-identity-behind-a-port.md).

```typescript
export interface VerificationProvider {
  /** Begin a step-up. Returns a redirect (UAE PASS) or a challenge (OTP). */
  challenge(request: VerificationRequest): Promise<VerificationChallenge>;
  /** Complete it. Returns the achieved assurance and the verified attributes. */
  verify(challengeId: ChallengeId, response: VerificationResponse): Promise<AssuranceResult>;
  /** B11 tab 1's account-ownership check — the most consequential toggle in the product. */
  confirmAccountOwnership(identity: VerifiedIdentity, account: AccountRef): Promise<OwnershipResult>;
  supportedLevels(): AssuranceLevel[];  // L0 anonymous … L1 verified … L2 verified+otp … L3 verified+document (RISK-006, resolved — see data-model.md §4.11)
}

export interface AssuranceResult {
  readonly level: AssuranceLevel;
  /** Emirates ID arrives ALREADY HASHED. The port's contract is that a raw national
   *  identifier never enters the application (§12 invariant 4, FR-VERI-09). */
  readonly identity: { emiratesIdHash: string; verifiedName: string; mobileMasked: string } | null;
  readonly verifiedAt: string;   // RFC 3339 UTC
  readonly expiresAt: string;    // assurance decays; a payment two hours later re-challenges
}
```

Four assurance levels, L0–L3 (RISK-006), monotonic: each satisfies every level below it. The step-up rule is evaluated **before** the tool call, never after (B11 tab 2 rule), which is a property of the runtime pipeline (§5.1 stage 3) and not of this port.

**Current adapter:** `MockVerificationProvider` — a first-class test fixture implementing all four levels and drivable to any state, not a stub ([ADR-0006](./adr/0006-identity-behind-a-port.md) rule 5). The step-up tests written against it are the tests that will validate `UaePassProvider` unchanged. **The mock cannot run in production**: adapter selection is environment configuration and the process refuses to boot if the mock is selected while the environment is Production (rule 6) — a mocked verification path in front of real payments is the worst failure this system could have, so it is prevented at startup rather than by policy.

**Swap cost: low in code, long in lead time.** `UaePassProvider` is one adapter; UAE PASS onboarding is a procurement dependency with a long lead time (RISK-004). Until it lands, the assurance guarantees are only as good as the mock, and that is stated plainly rather than implied by a green test suite.

### 9.10 `PaymentGateway`

**Purpose.** Move money. B11 tabs 3–4.

```typescript
export interface PaymentGateway {
  /** Idempotency key is a REQUIRED parameter, not an option — the type system
   *  makes an unguarded charge unexpressible (§1.5). */
  createIntent(request: PaymentIntentRequest, key: IdempotencyKey): Promise<PaymentIntent>;
  getTransaction(ref: GatewayRef): Promise<GatewayTransaction>;
  refund(ref: GatewayRef, amount: Money, key: IdempotencyKey): Promise<RefundResult>;
  /** Verify a callback signature. Returns a normalised event or throws — the adapter
   *  is the only place that knows this gateway's signature scheme (§10.2). */
  parseCallback(rawBody: Uint8Array, headers: Headers): Promise<GatewayEvent>;
  supportedMethods(): PaymentMethod[];  // card | apple_pay | bank_transfer | direct_debit
}
```

Declines are **normalised**: `RefundResult` and `PaymentIntent` carry a `reason` from an SHJ3-owned closed vocabulary (`insufficient_funds`, `card_expired`, `do_not_honour`, `limit_exceeded`, `gateway_declined`), never the acquirer's text (§2.4). Adding a gateway never adds a reason token. `Money` is minor units plus currency (§1.8); the port has no float in it anywhere.

**Current adapter:** `SharjahPayGateway` (Live), `SewaDirectDebitGateway` (Sandbox).

**Swap cost: low per gateway, and the port is designed for *multiple* rather than swapping.** B11 tab 3 lists two gateways with different method sets, so the resolver picks an adapter per payment method and per service. Adding a third is one adapter plus one callback route (§10.2); the domain's transaction state machine does not change, because it is expressed in normalised events.

### 9.11 `ChannelTransport`

**Purpose.** Deliver a message to a citizen on a specific surface, and normalise what arrives back. This is where "channel adaptation is structural, not cosmetic" (A1 rule) is actually implemented.

```typescript
export interface ChannelTransport {
  readonly channel: ChannelId;              // 'web' | 'whatsapp' | 'mobile' | 'kiosk'
  /** Render a domain message into this channel's native form and send it.
   *  WhatsApp turns suggestions into a list message; web turns them into chips.
   *  The domain emits one OutboundMessage and never branches on channel. */
  send(message: OutboundMessage, key: IdempotencyKey): Promise<DeliveryReceipt>;
  /** Template send — the only way to open a closed WhatsApp session window. */
  sendTemplate(send: TemplateSend, key: IdempotencyKey): Promise<DeliveryReceipt>;
  /** Verify and normalise an inbound webhook into domain events. */
  parseInbound(rawBody: Uint8Array, headers: Headers): Promise<InboundEvent[]>;
  /** Can a free-form message be sent right now? Enforced INSIDE send() too — this
   *  is for the UI, not the guarantee (§10.1). */
  sessionState(recipient: RecipientRef): Promise<SessionWindowState>;
  capabilities(): ChannelCapabilities;  // supportsChips, supportsListMessage, supportsRichMedia,
                                        // requiresOptIn, sessionWindowHours, maxMessageLength
}
```

`capabilities()` is what keeps channel knowledge out of the domain. A flow node declares five suggestions; the web transport renders chips, the WhatsApp transport renders a list message, and a hypothetical IVR transport renders a spoken menu. No `if (channel === 'whatsapp')` exists outside an adapter.

**The session-window and opt-in checks live inside `send()`**, not in the caller. A human agent's reply (B8), a campaign send (B10 tab 4) and an assistant turn all pass through the same method, so none of them can bypass the rule by being written carelessly. A closed window throws `SessionWindowClosed` → `409 conversation.session_window_closed`.

**Current adapters:** `MetaCloudWhatsAppTransport`, `WebWidgetTransport` (SSE, §4.3). Mobile app and Kiosk/IVR are registered channels with no adapter — selecting them returns `501 adapter.not_implemented` rather than pretending (B10 tab 1 shows both `Disabled`).

**Swap cost: low.** Meta Cloud API → Twilio, 360dialog or another BSP is one adapter, because the session window, the opt-in requirement and the template model are WhatsApp platform rules that every BSP exposes. A genuinely different channel (IVR) is a new adapter plus new `capabilities()` values, and no domain change.

### 9.12 `McpClient`

**Purpose.** Speak MCP: connect, discover, invoke. B3 step 4B, B5 tab 2.

```python
class McpClient(Protocol):
    async def connect(self, server: McpServerConfig) -> McpSession:
        """Handshake with the configured auth. Raises McpConnectFailedError with a
        CLOSED-SET reason (dns | tls | auth | timeout | protocol) — never a driver
        exception message (§2.4)."""
    async def discover_tools(self, session: McpSession) -> list[ToolDescriptor]:
        """tools/list. Descriptors carry name, description and JSON Schema."""
    async def invoke(self, session: McpSession, call: ToolCall,
                     timeout_ms: int) -> ToolResult:
        """Arguments are validated against the discovered schema BEFORE the call."""
    async def close(self, session: McpSession) -> None: ...
```

Two guarantees this port carries rather than delegates:

1. **Discovery does not imply permission.** Persisted descriptors are what invocation checks against for an explicit binding, above this port (`403 tools.not_bound`, §5.6). "Registered ≠ callable" is the B3 step 4 rule, and the port's shape reflects it — `invoke` takes a `ToolCall` that the tools module only constructs for a bound tool. **`discover_tools` itself does not persist anything** — `shj3-ai`'s DB grant (data-model.md §5's ADR-0005 enumeration) has no `SELECT`/`INSERT`/`UPDATE` on `McpServers`/`McpTools` at all, so `POST /v1/tools/mcp/servers/{id}/connect` (§5.6) is stateless with respect to those tables: it returns discovered descriptors in its response, and `shj3-web`'s own already-built `recordSuccessfulDiscovery`/`recordConnectionFailure` (§6.5) is what actually persists them. An earlier draft of this doc said "persists descriptors" — corrected once a real implementation existed to check the grant against.
2. **The breaker is consulted before `invoke`, not inside it.** Breaker state belongs to the `tools` domain and lives in `CacheStore`; putting it inside the MCP adapter would mean re-implementing it for the API-connector path. One breaker implementation, two call paths (B5 tab 4).

**Current adapter:** `McpSdkClient`, built on the official `mcp` Python SDK (`modelcontextprotocol/python-sdk`) — `connect`/`discover_tools`/`close` are real and live-verified against a real external MCP server; `invoke` is implemented for real too, with no caller yet (tool *invocation* through a bound MCP tool remains the agent runtime's own separate work).

**Swap cost: low, already exercised once.** The reference MCP Python SDK is the real, shipped choice (not ADK) — MCP is a specification rather than a vendor, which is why this was the cheapest swap on the list, and why the brief's "integrations will use MCP, API" (R4) was a good structural choice, not just a technology preference. A hand-rolled JSON-RPC client remains the next-cheapest swap if the reference SDK is ever outgrown.

### 9.13 What this section is worth

Twelve ports, and a rule that gives them teeth: `domain/` and `application/` contain zero vendor imports, checked by grep in pre-commit ([`architecture.md`](./architecture.md) §4). The consequences are concrete rather than architectural taste:

- RISK-001 — citizen text leaving the UAE via OpenAI and Cohere, against B14 tab 4's residency default — is remediable by swapping two adapters and running a re-index. Not a rewrite.
- SSO arrival is one adapter, one config change, one dropped table.
- UAE PASS arrival is one adapter, with the step-up test suite already written and passing against the mock.
- Replacing Qdrant with pgvector, or Neo4j with Memgraph, touches one file each.
- The B13 regression suites are a model-selection instrument, because the model is a config row.

A port that cannot be swapped is documentation, not architecture. Each entry above names its swap cost so the claim is falsifiable.

---

## 10. Webhooks & outbound

Three flows where SHJ3 is not the initiator, and one where it is. All four are unversioned or externally versioned, because the URL lives in someone else's console.

### 10.1 Inbound WhatsApp

Defined in §4.4; the guarantees restated here as contract, since this is the one route an unauthenticated third party can reach with a body.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/webhooks/whatsapp` | `hub.verify_token`, constant-time compare | Meta subscription verification handshake |
| `POST` | `/api/webhooks/whatsapp` | `X-Hub-Signature-256` HMAC-SHA256 over raw bytes | Inbound messages, delivery/read receipts, template status changes |

1. **Signature over raw bytes, verified before parsing.** The adapter reads the raw stream, computes `HMAC-SHA256(appSecret, rawBody)` and compares in constant time. Mismatch or absent → `403 webhook.signature_invalid`, empty body, **and the payload is never deserialised**. A parser bug is therefore not reachable by an unauthenticated caller. Bodies over 512 KiB are rejected `413` unread beyond the cap.
2. **Replay protection by message-id dedupe.** Meta sends no usable freshness bound, so `setIfAbsent('public:wa:msg:{messageId}', 72h)` is the guard (§9.7). Already present → **`200`**, no processing, `webhook.replay_detected` counted as a metric. `200` rather than `409` is deliberate: a `4xx` to Meta triggers redelivery, and redelivering a duplicate is worse than acknowledging one. Secondary defence: the outbound side is idempotent anyway (§1.5), so a replay that slipped through would not double-send.
3. **Acknowledge in under 5 seconds, process asynchronously.** The route enqueues and returns `200`. A webhook that does the model turn inline will be retried into a storm the first time the model is slow.
4. **Unrecognised payload shapes are acknowledged**, logged with the trace id and counted (`webhook.payload_unrecognised`). A new Meta field must not break inbound messaging.
5. **Template status changes drive the B10 tab 3 → tab 4 unblock.** Meta approving `appointment_confirmation` arrives on this route and sets the template to `approved` in one transaction with the audit entry; campaign state is *derived* from template status (§6.9), so the campaign unblocks with no sync step.
6. **The 24-hour session window** is set by each inbound message and enforced at send time inside `ChannelTransport.send()` (§9.11), never by the UI remembering. Closed window → `409 conversation.session_window_closed`, `meta.requiredTemplate: true`, and that applies equally to an assistant turn, a human agent's reply from B8, and a campaign send.
7. **`STOP` revokes opt-in synchronously**, writes a consent-ledger entry (B14 tab 4) and suppresses all future outbound sends to that number — checked at send time (§10.3).

### 10.2 Payment gateway callbacks

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/webhooks/payments/{gatewayId}` | Gateway-specific signature, verified in the adapter via `PaymentGateway.parseCallback()` (§9.10) | Authorisation, capture, settlement, failure, refund and chargeback events |

The path is per-gateway because signature schemes differ; the handler downstream of `parseCallback` is one normalised state machine (B11 tab 3 lists two gateways today, and adding a third must not add a second state machine).

**Idempotent.** Dedupe key is `(gatewayId, gatewayEventId)`, claimed with `setIfAbsent` for 30 days — comfortably longer than any gateway's retry horizon. A duplicate is `200`, unprocessed. The `Transaction` write is additionally guarded by the state machine below, so even a dedupe miss cannot double-apply.

**Out-of-order tolerant.** Gateways retry, and a retry of an earlier event can arrive after a later one. The transaction state is therefore a **monotonic machine keyed on the event's `occurredAt` and rank**, not a series of assignments:

```
initiated → authorised → settled → refund_requested → refund_pending_gateway → refunded
                   ↘ failed                                              ↘ refund_declined
settled → chargeback_opened → chargeback_lost | chargeback_won
```

Rules:

1. Each state has a rank. An event whose target state ranks **at or below** the current state is recorded in the transaction's event history and does **not** change the state. So a late `authorised` arriving after `settled` is stored as evidence and ignored as a transition — never a regression from settled back to authorised.
2. An event with an `occurredAt` older than the transaction's `stateChangedAt` is likewise history-only. Both guards exist because rank alone cannot order two events in the same state and timestamps alone cannot be trusted across a retry.
3. Forward jumps are legal. If `authorised` was never delivered and `settled` arrives, the transaction moves to `settled` and the missing event is flagged `meta.gapDetected` on the record for reconciliation — a gap is an operational fact, not a reason to reject money that has actually moved.
4. Terminal states (`refunded`, `refund_declined`, `chargeback_lost`, `chargeback_won`) accept no further transitions. A later event → `200`, history-only.
5. **The callback is the source of truth for money, not the approval click.** `POST /payments/transactions/{ref}/refund/approve` (B11 tab 4) calls the gateway and leaves the transaction in `refund_pending_gateway`; only the callback moves it to `refunded`. If the gateway call fails, the transaction stays pending and the UI says so rather than claiming a refund that did not happen.
6. Every state change writes an audit entry in the same transaction (§12 invariant 3), and transaction records are retained **7 years** regardless of transcript retention (B14 tab 4 carve-out).
7. Unknown `gatewayId`, or a signature that does not verify → `403 webhook.signature_invalid`. Never `404`: confirming which gateway ids exist is free reconnaissance.

### 10.3 Outbound proactive sends

B10 tab 4. The rule is short and the enforcement point is the whole point: **a send requires both an approved template and a recorded opt-in, checked at send time — not only at configuration time.**

| Method | Path | Permission | Purpose |
|---|---|---|---|
| `POST` | `/api/backoffice/channels/campaigns/{id}/enable` | `agents.manage` | Arm a trigger. Config-time check. |
| `POST` | `/api/backoffice/channels/campaigns/{id}/send-now` | `agents.publish` | Immediate fan-out. `202` + job. |
| `GET` | `/api/backoffice/channels/campaigns/{id}/sends` | `analytics.view` | Per-send log with outcome and skip reason — the evidence the checks ran |

**Two check points, deliberately not one:**

*Config time*, on `enable`: the template must be `approved`, else `409 channels.template_not_approved`. This is what makes the wireframe's Blocked toggle refuse to turn on, and because campaign state is derived from template status (§6.9), approving the template in tab 3 unblocks tab 4 with nothing to synchronise.

*Send time*, per recipient, inside the send job — the checks that actually protect a citizen:

| # | Check | On failure |
|---|---|---|
| 1 | Template still `approved`. Meta can revoke an approval after a campaign was armed. | Whole batch aborts, campaign flips to `blocked`, `channels.template_not_approved` on the job |
| 2 | Recipient has a **current recorded opt-in** for this channel and category. `STOP` between arming and sending revokes it. | Recipient skipped, `channels.optin_missing` in the send log. Not fatal to the batch. |
| 3 | Recipient is not on a suppression list (hard bounce, complaint, erasure request) | Skipped, reason logged |
| 4 | **Quiet hours** — no sends between **21:00 and 07:00 `Asia/Dubai`** | Recipient re-queued to 07:00, not dropped. If the entire window is closed at submission, `send-now` returns `409 channels.quiet_hours` up front. |
| 5 | Session window: a free-form message needs an open 24-hour window; outside it a template send is the only permitted form (§10.1 rule 6) | Falls back to the approved template, or skips |
| 6 | Per-tenant outbound rate and daily cap (§11) | Batch throttled, not failed |
| 7 | Idempotency: `(campaignId, recipientHash, triggerOccurrenceId)` claimed before the send | Duplicate skipped silently |

The checks live in the send path, not in a validator the caller may or may not have run: checks 1, 2 and 4 are inside `ChannelTransport.send()` and the campaign use case respectively (§9.11), so no code path — human agent, campaign, assistant turn, or a future integration — can send without them. Configuration-time validation is a courtesy that gives the admin a fast error; **send-time validation is the guarantee**, because between arming a campaign and its trigger firing three days before a bill is due, the template can be revoked, the citizen can reply `STOP`, and the clock can reach 21:00.

Quiet hours apply to proactive sends only. They do not gate a reply to a citizen who just messaged at 23:00 — suppressing an answer to a live question would be worse service, not better privacy. **[ASSUMPTION]**, and the distinction is `OutboundMessage.kind: 'reactive' | 'proactive'`, set by the caller and validated against the conversation's last inbound timestamp so `reactive` cannot be claimed falsely.

Delivery receipts arrive on the inbound webhook (§10.1) and update the send log, which is what makes B10 tab 4's `4,210 this month` a counted fact rather than an attempt count.

---

## 11. Rate limiting & quotas

Three independent limiters and one cost ceiling. They compose: a request must pass every applicable limiter, and the response reports the **most constrained** one.

### 11.1 Limits

| Scope | Key | Limit | Window | Applies to |
|---|---|---|---|---|
| Citizen session | `rl:cs:{sessionId}` | 20 turns, 60 non-turn requests | 60 s sliding | Public API (§4) |
| Citizen session, daily | `rl:cs:{sessionId}:d` | 300 turns | 24 h | Public API |
| Client IP | `rl:ip:{ip}` | 120 requests; 10 conversation opens | 60 s sliding | Public API, pre-session |
| Channel key | `rl:ck:{channelKey}` | 600 requests | 60 s | Public API — a per-embed ceiling, so one misbehaving portal page cannot exhaust the tenant |
| TTS / STT | `rl:cs:{sessionId}:speech` | 20 requests | 60 s | `POST …/speech`, `…/transcriptions` — these are expensive per call |
| Verification | `rl:cs:{sessionId}:otp` | 5 attempts per challenge, 3 challenges | per challenge / 15 min | Step-up (B11 tab 2). Exhaustion burns the challenge: `429 verification.attempts_exhausted`. |
| Login | `rl:login:{emailHash}` + `rl:login:{ip}` | progressive backoff then a 15-min lock | — | `POST /auth/sessions`. Returns `401 auth.account_locked`, **not `429`** — a `429` would distinguish a real account from an unknown email (§2.2). |
| Staff session | `rl:usr:{userId}` | 600 requests | 60 s | Backoffice API — a runaway UI poll, not an attacker |
| Tenant | `rl:tenant` | 6,000 requests, 400 concurrent turns | 60 s | All surfaces. The noisy-neighbour ceiling. |
| Tenant tokens | `q:tenant:tokens:{month}` | configured per tenant | calendar month | Model spend |
| API key | `rl:key:{keyId}` | per-key, set at issue | 60 s | Reserved. **[ASSUMPTION]** — no wireframe screen issues API keys; the limiter and headers exist so that when a machine-to-machine integration appears it is not retrofitted. Keys are tenant-scoped and carry a permission subset; a key can never exceed the permissions of the principal that minted it. |
| Outbound sends | `rl:tenant:outbound` | 60/s, 50,000/day | 1 s / 24 h | §10.3 check 6 |
| Internal API | — | none | — | mTLS, single caller. `shj3-web` is the limiter; adding a second there would only hide a bug. |

Counters are `CacheStore.increment` with expiry (§9.7), so a limit is shared across replicas rather than per-pod. All keys are tenant-prefixed by construction.

### 11.2 Response headers

RFC 9331 draft form on every response, success or failure, reporting the limiter closest to exhaustion:

```http
HTTP/1.1 200 OK
RateLimit-Limit: 20
RateLimit-Remaining: 14
RateLimit-Reset: 37
RateLimit-Policy: 20;w=60;comment="citizen-session-turns", 6000;w=60;comment="tenant"
```

On rejection:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 37
RateLimit-Limit: 20
RateLimit-Remaining: 0
RateLimit-Reset: 37
Content-Type: application/problem+json

{
  "type": "https://api.shj3.gov.ae/problems/rate_limit.exceeded",
  "title": "Too many requests",
  "status": 429,
  "code": "rate_limit.exceeded",
  "detail": "Please wait a moment before sending another message.",
  "traceId": "4bf92f…",
  "requestId": "req_01JBR2",
  "timestamp": "2026-09-08T09:14:02.110Z",
  "meta": { "scope": "citizen_session", "retryAfterSeconds": 37 }
}
```

`meta.scope` names which limiter fired — `citizen_session` | `ip` | `channel_key` | `staff_session` | `tenant` | `api_key` | `outbound`. It never names another tenant's usage, and `detail` is citizen-safe copy on the public surface: a rate-limit message is one of the few error strings a citizen actually reads. `429` responses carry no `RateLimit-Policy` for scopes the caller does not own, so a citizen cannot infer tenant-wide load.

Enforcement sits in the inbound adapter, before authorization and before any handler code — a rate-limited request costs one Redis `INCR`.

### 11.3 Per-agent ceilings — B4

Distinct from rate limiting: these bound a **single turn's** work, and they are the agent's configuration, not the platform's.

| Ceiling | Config field | Enforced | Breach |
|---|---|---|---|
| Max hops | `maxHops` (1–20) | Before dispatching hop N+1 | SSE `error`, `orchestration.hop_ceiling_exceeded`; partial trace persisted |
| Max tool calls | `maxToolCalls` | Before each tool invocation | SSE `error`, `orchestration.loop_detected` when the excess is a repeat of an identical call |
| Loop ceiling | `maxRepeatedCalls` | On an identical `(toolName, args)` triple recurring | SSE `error`, `orchestration.loop_detected` |
| Cost ceiling | `maxCostAed` | **Before** each model call, using `ChatModel.count_tokens()` plus the model's configured rate | SSE `error`, `orchestration.cost_ceiling_exceeded` |
| Turn deadline | `deadlineMs` | Wall clock across the whole pipeline | SSE `error`, `model.timeout` or `tools.invocation_timeout` per the stage that overran |
| Tenant monthly spend | `q:tenant:tokens` | Before the turn starts | `429 quota.tenant_exceeded` |

Four points that make these real rather than decorative:

1. **Ceilings are checked before spend, not after.** `count_tokens()` exists on the `ChatModel` port (§9.1) precisely so the cost ceiling can be pre-flight. A ceiling enforced after the call has already been paid for is an accounting note.
2. **A breach is a graceful turn outcome, not a `5xx`.** The stream terminates with `error`, the citizen sees the configured degraded message, handover is offered where staffed, and the partial trace persists so B1 tab 3 and B14 can see it happened. A ceiling breach that produced a blank screen would be indistinguishable from an outage.
3. **Cost and tokens are recorded per call against tenant, agent and conversation** ([ADR-0004](./adr/0004-llm-gateway-and-retrieval-models.md) rule 5) from day one. B4's ceilings cannot be enforced without that accounting, and "Cost & quota management" is a named gap in the wireframe (§8 of the guide) — the accounting exists now so the screen can be built later without a data backfill.
4. **Mode choice moves the ceilings, and the API says so.** Parallel is fastest but risks overlap; supervisor–worker is most controlled but costs the most tokens (B4 rule). `PUT /orchestration/config` therefore validates that `supervisor_worker` has `maxHops ≥ 3` and returns `meta.estimatedCostMultiplier` so an admin selecting a mode sees its cost consequence before saving, rather than discovering it on the invoice.

---

## 12. API-wide invariants

Twelve rules that hold on every endpoint of every surface. Each has an enforcement point and a test; a change to any of them is an ADR, not a patch.

1. **Tenant comes from the authenticated principal only.** Never from a header, query parameter, route parameter or body. A caller cannot name their own tenant. Middleware resolves it, binds it to request scope (`AsyncLocalStorage` / `contextvars`), and the data-access layer derives every store handle from that context — schema, Neo4j database, Qdrant collection name, Redis key prefix ([`architecture.md`](./architecture.md) §5). **Unscoped clients are not exported**: `getPrismaClient()` does not exist, only `getTenantDb()`. A use case cannot express a cross-tenant query because the vocabulary is absent. Two audited escape hatches exist in `platform`, both `Super Admin`. Proven by `tenant-isolation.spec` across all four stores, including a direct attempt to forge the tenant in a payload.

   A payload that tries is rejected, not ignored:

   ```http
   PATCH /api/backoffice/agents/agt_01JB HTTP/1.1
   Content-Type: application/json
   Cookie: shj3_bo=…            # principal's tenant is 'sewa'

   { "name": "Customs Enquiry Agent", "tenantId": "customs" }
   ```

   ```http
   HTTP/1.1 403 Forbidden
   Content-Type: application/problem+json

   {
     "type": "https://api.shj3.gov.ae/problems/authz.tenant_mismatch",
     "title": "Tenant cannot be specified by the caller",
     "status": 403,
     "code": "authz.tenant_mismatch",
     "detail": "The tenant is resolved from the authenticated principal. Remove 'tenantId' from the request.",
     "instance": "/api/backoffice/agents/agt_01JB",
     "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
     "requestId": "req_01JBR4",
     "timestamp": "2026-09-08T09:15:11.004Z",
     "meta": { "rejectedField": "tenantId" }
   }
   ```

   Note what the response does **not** contain: the principal's actual tenant, whether `customs` exists, or whether the agent exists in it. And note the status — `403`, not `422`. A forged tenant is not a validation mistake; treating it as one would log it as a schema problem instead of a security event. It is logged at `warn` with the trace id and the principal, and it fires an alert. The same rejection applies to `tenantId`, `tenant`, `entityId`, `schema` and `collection` anywhere in any body on any surface: the field list is denied globally in the request pipeline, before per-route schemas run, so a new route cannot accidentally accept one.

2. **Deny by default.** Every backoffice route declares exactly one permission (or an AND-set) from B9's 7×8 matrix, typed as `Permission`. A route without one does not compile and fails a lint rule that scans `app/api/backoffice/**/route.ts` (§3.4). There is no unguarded backoffice route and no wildcard grant. Team/entity scope is a second, separate check inside the use case. The permission check runs before any handler code and before any query. Every route is tested against all 7 roles with the B9 matrix as the fixture.

3. **The audit entry is written in the same database transaction as the change it audits.** Not after, not by a listener, not on a queue. If the audit insert fails, the change does not happen. B14 tab 1's *"either action removes the item and writes an entry to the audit log in real time"* is a transactional guarantee (§6.12). The audit table has `INSERT` and `SELECT` grants and no `UPDATE` or `DELETE` grant for any database user, so immutability is a permission the application does not hold rather than a rule it chooses to follow — no role, including `Super Admin`, can edit or delete an entry (`405 governance.audit_log_immutable`).

4. **PII is masked before persistence, never on read.** A transcript, trace, log line or tool-argument record is written already masked, so a later bug in a read path cannot leak what was never stored (`mask_pii`, locked, B12 tab 1). Emirates ID arrives from `VerificationProvider` already hashed (§9.9). Unmasked values exist only in memory for the duration of the tool call that needs them. Error bodies never echo an unmasked value, including inside `errors[].detail` (§2.2).

5. **A locked policy toggle is rejected, never silently ignored.** `mask_pii` and `prompt_injection_filter` are the platform floor and cannot be changed by any role. Three layers: the write schema for a locked policy admits no `enabled` field (`422 validation.failed`, `field.unknown`); the governance layer refuses independently (`409 governance.policy_locked`); and the runtime pipeline runs those checks structurally, reading no configuration to decide whether to run them ([`architecture.md`](./architecture.md) §7). Overrides against a locked policy are `422 governance.override_forbidden_for_locked_policy`. A silently-ignored toggle would let an admin believe a guardrail is off when it is on — or worse, believe it is on when it is off.

6. **No vendor error text, status code or identifier appears in any response.** Failures from OpenRouter, OpenAI, Cohere, Neo4j, Qdrant, MCP servers, the BSP or a payment gateway are caught in the outbound adapter and re-raised as SHJ3 domain errors with a stable `code` and, where relevant, a `meta.reason` from a closed SHJ3-owned vocabulary (§2.4). Vendor detail is logged once against the trace id. Adding a vendor never adds a reason token, and no caller can fingerprint the model gateway.

7. **One error shape.** RFC 9457 `application/problem+json` on every surface, with a stable machine-readable `code`, a `traceId` and a `requestId`. Clients branch on `code`, never on prose. Error bodies never carry stack traces, SQL, Cypher, schema names, internal hostnames, prompts or retrieved passages (§2.2). One serialisation function per runtime; no handler builds a problem document by hand.

8. **Unknown request fields are rejected, not stripped.** `422 validation.failed` with `field.unknown`. Validation is exhaustive, not fail-fast. Unrecognised filter and sort fields are rejected too — a silently dropped filter shows a user more data than they asked for, which on a multi-tenant government system is a security behaviour, not a UX detail.

9. **Collections are cursor-paginated, and there is no `totalCount`.** Offset pagination can duplicate or skip a row under head insertion, which is unacceptable for an append-only audit record and unscalable for the conversation explorer (§1.3). Cursors are opaque, filter-bound, 15-minute-lived, and cannot widen a query.

10. **Every timestamp on the wire is RFC 3339, UTC, with an explicit `Z`.** No local times, no epoch integers. Wall-clock rules that are inherently local — quiet hours, working hours — carry an explicit IANA zone alongside them. Money is an integer minor unit plus a currency code; no float touches a transaction (§1.8).

11. **Money-moving and outbound-message endpoints require an `Idempotency-Key`.** Absent → `400`. Same key with a different body → `422 idempotency.key_reused`, which is the case that matters: it catches a client reusing a key across two different refunds, where silently succeeding would lose one (§1.5). Payment gateway callbacks are idempotent on `(gatewayId, eventId)` and tolerate out-of-order delivery through a ranked, monotonic state machine (§10.2). Outbound sends are idempotent on `(campaignId, recipientHash, triggerOccurrenceId)`.

12. **Rules that protect a citizen are enforced at the point of action, not at the point of configuration.** Step-up assurance is checked before the tool call, never after (B11 tab 2). Template approval and opt-in are checked at send time, per recipient, inside `ChannelTransport.send()` — not only when the campaign was armed (B10 tab 4, §10.3). The WhatsApp session window is enforced in the transport, so a human agent cannot bypass it by typing. Tool binding is checked at invocation, so discovery never implies permission (B3 step 4). Configuration-time checks are a courtesy that gives an admin a fast error; the enforcement point is the guarantee.

Two corollaries worth stating because they are frequently assumed away:

- **Publish is not deploy** (RISK-009). `POST /agents/{id}/publish` makes a version current within its environment; moving a version between environments is a promotion and requires approval (B14 tab 1, §6.12). Neither endpoint can perform the other's job, and rollback (B2) is a third, distinct operation that changes only *which version is current*.
- **A publish gate names every failing condition, not the first** (RISK-007). `GET /evaluation/publish-gate/evaluation` returns `reasons[]`, and `409 agent.publish_gate_blocked` carries all of them. An admin fixing one failure and re-submitting into a second failure learns nothing about how far away they are.

---

## 13. Traceability

| Wireframe screen | Sections |
|---|---|
| A1 Launcher & widget shell | §4.2 (bootstrap, conversations, suggestions), §4.4 (WhatsApp rendering, 24-h window), §7.3 (theme) |
| A2 Conversation & dynamic flow | §4.3, §5.1, §5.2, §5.3 (trace + sources rails), §6.2 (feedback) |
| A3 Voice input & human handover | §4.2 (transcriptions, handover, events), §6.8 |
| B1 Command centre | §6.2, §6.13 (add to golden set) |
| B2 Agent registry | §6.3 (clone, publish, unpublish, archive, rollback) |
| B3 Agent designer wizard | §6.3 (save-per-step), §6.5 (step 4), §5.7 (sandbox) |
| B4 Orchestrator / router | §6.4, §5.1, §11.3 (ceilings) |
| B5 Tools & MCP registry | §6.5, §5.6 (breakers) |
| B6 Knowledge — Graph RAG | §6.6, §5.4 (retrieval), §5.5 (graph, jobs) |
| B7 Flow designer | §6.7 (escape-node invariant) |
| B8 Human agent workspace | §6.8 (queue, reorder, rule tester) |
| B9 Users, teams & roles | §3.3, §3.4, §3.6, §6.1 |
| B10 Channel configurations | §6.9, §4.4, §10.1, §10.3 |
| B11 Identity & transactions | §3.5, §6.10, §6.11, §10.2, §9.9, §9.10 |
| B12 Guardrails & policies | §6.12, §5.1 (stages 1 and 5), §12.5 |
| B13 Evaluation & testing | §6.13, §5.7 |
| B14 Governance & ops | §6.12, §5.8 (observability), §12.3 |
| Phase E Theming | §7 |
| Phase F User guide | §8 |

**Endpoint totals**

| Surface | Endpoints |
|---|---|
| Public / citizen (§4) | 20, plus 2 WhatsApp webhook routes and 1 payment callback |
| Internal `shj3-ai` (§5) | 47 |
| Backoffice (§6) | 223, plus 8 session/TOTP endpoints (§3.2) |
| Theming (§7) | 22 authoring + 2 resolution |
| User guide (§8) | 10 |
| **Total** | **332**, plus the 3 externally-addressed webhook routes |

Ports: 12 (§9). Error codes defined: 158 (§2.5). Modules covered: 17 of 17.
