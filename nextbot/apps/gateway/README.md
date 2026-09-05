# nextbot-gateway

GATEWAY PLANE — all channel ingress + ALL MCP/model-provider/A2A egress; PEP re-check, credential injection, circuit breaker live here (ADR-0004).

**Phase 7 (BL-04) status:** the first real surface implemented here is the widget's
anonymous real-time channel (`/api/v1/widget/**`, LLD §5.3) — session issuance
(`POST /sessions`), inbound messages (`POST /messages`, idempotent on
`clientMessageId`), the SSE outbound stream (`GET /stream`), typing (`POST /typing`),
and language selection (`POST /language`). A minimal Next.js App Router app (Route
Handlers only, no pages/portals) — chosen because LLD §5.3 explicitly justifies SSE
over WebSockets by "Next.js Route Handlers stream natively," and a second, thin
Next.js deployable is the least-new-infrastructure way to make that literally true for
this plane, without inventing a hand-rolled HTTP server/router for 5 endpoints.

**MCP/model-provider/A2A egress is not implemented here yet** — that is Phase 12's
scope (Tier-1 tool calls), the phase that structurally needs the PEP re-check +
credential injection this plane exists for. Deferring it mirrors the same judgment
call recorded in the Phase 4 dispatch (connector discovery reachable from `apps/web`
directly until the phase that needs true process separation).

**CORS is currently wildcard** (`Access-Control-Allow-Origin: *`) rather than enforced
against a channel's `WebWidgetConfig.allowedOrigins` — flagged in
`src/lib/cors.ts`'s doc comment as a hardening item for whichever phase builds the
full channel-management UI (no admin screen collects a real allowlist yet).
