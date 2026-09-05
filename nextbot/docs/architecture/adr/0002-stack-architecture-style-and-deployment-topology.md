# ADR-0002 — Stack, architecture style, deployment topology, and library set

**Status:** Accepted · 2026-08-15
**Context refs:** spec §9.2 (hard stack constraint), NFR-1/2/3/6/7/8/12, FR-AGT-04/05, FR-SEC-03
**Supersedes:** nothing. This is the Nexus architecture-guide §8 "stack ADR".

## 1. Stack — Option B (Next.js full-stack + Google ADK TypeScript)

Taken as-is, and additionally mandated: `PRODUCT_SPECIFICATION.md` §9.2 fixes Next.js for all five
portals and Google ADK TypeScript for the agent core. This is also the guide's default for
AI-centric products, so there is nothing to justify. Options A and C were not evaluated because the
spec forecloses them.

Consequence per guide §2: **an AI subsystem exists**, so TypeBox is mandatory and the
provider-agnostic registry rules apply. See ADR-0006.

## 2. Architecture style — modular monolith per plane

Default taken: **modular monolith**, not microservices-per-feature. Each of the four planes is one
deployable containing many modules with lint-enforced boundaries (HLD §6). There is no
"connector service", "escalation service", or "reporting service" — those are modules.

## 3. Deployment topology — multi-container (4 images), regional cells

**Deviation from the single-container default. Concrete requirement:** NFR-3 states verbatim that
the platform must support "horizontal scale-out of the Data Plane (Agent Runtime) independent of
Control/Gateway/Observability planes". A single container cannot satisfy an explicitly independent
scaling requirement. Two further concrete requirements reinforce the split:

- The Gateway Plane terminates long-lived bidirectional connections (voice media streams, Gateway
  Agent reverse tunnels per FR-MCP-12, widget SSE). Redeploying it on every Admin Console CSS change
  would drop live customer calls and on-prem tunnels — an availability requirement (NFR-1) that a
  shared deployable violates by construction.
- NFR-6 requires per-region data residency, which requires deploying the whole stack per region as a
  cell. That is orthogonal to image count but is recorded here as part of the topology decision.

Deployables: `nextbot-web` (Control), `nextbot-runtime` (Data), `nextbot-gateway` (Gateway),
`nextbot-worker` (Observability/batch). Local/dev uses docker-compose with the same four images;
production is orchestrated (k8s or equivalent). Detail in HLD §7.

**What was deliberately *not* split:** the five portals (one Next.js app — they share auth, tenant
context, RBAC, i18n and design system), and per-feature backend services. Splitting either would be
microservices without a requirement forcing it.

## 4. Library set

Defaults from guide §5.2 taken as-is (one line each, no defense needed):

| Category | Choice |
|---|---|
| Validation / schema | **TypeBox** everywhere — forms, Server Action inputs, Route Handlers, inter-plane contracts, ADK structured output. AI subsystem present, so this is mandatory, not preferred. **Scoped exception:** `packages/mcp-client` additionally depends on **Ajv**, confined there by a `dependency-cruiser` rule — MCP tool schemas are arbitrary third-party JSON Schema supplied at runtime (FR-MCP-02), so there is no compile-time TypeBox type to author against; `Value.Check` remains the validator for every TypeBox-emitted schema everywhere else in the platform. This is a scoped addition, not drift from the TypeBox mandate. |
| Forms | React Hook Form + `@hookform/resolvers` (typebox resolver) |
| Server state | TanStack Query |
| Client state | Zustand |
| UI / styling | ~~Chakra UI (Ark UI primitives underneath)~~ **Superseded by ADR-0010 (2026-08-18): shadcn/ui + Tailwind CSS v4 + Base UI, applied to all three apps (`apps/web`, `packages/ui`, `apps/widget-embed`).** |
| Testing | Vitest (unit) + Playwright (e2e) |
| AI framework | `@google/adk` (TypeScript), behind ADR-0006's registry and ADR-0003's port |

### 4.1 Deviation — ORM: **Drizzle** instead of Prisma

**Concrete requirement:** ADR-0001 makes RLS load-bearing. Every statement must execute inside a
transaction that has issued `SET LOCAL app.current_tenant`, against a connection pool in transaction
pooling mode. Drizzle is a thin driver-level layer where that wrapper is a ~30-line primitive over
`db.transaction`, with the raw connection semantics fully visible. Prisma mediates connections
through its own client/pool layer, which makes session/transaction-scoped GUC guarantees fragile and
hard to prove in a test — and the guarantee here is the platform's core security control, so
"probably fine" is not acceptable. Secondary reasons: hand-tuned SQL is needed on the conversation/
trace read paths and for pgvector KB queries, and Drizzle is explicitly listed in guide §5.2 as an
acceptable alternative. Trade-off accepted: weaker migration tooling and less mature DX than Prisma;
mitigated by drizzle-kit migrations reviewed as code and the ADR-0001 §6 schema-drift test.

### 4.2 Deviation — Auth: **Better Auth** instead of Auth.js v5

**Concrete requirement:** FR-SEC-03 and FR-ADM-02 require, together: per-tenant SAML **and** OIDC
SSO, SSO-group→role mapping, per-role MFA enforcement across TOTP / SMS / email with backup codes,
configurable failed-attempt lockout with a message distinct from "incorrect password", and an
organization/membership model. Auth.js v5 ships none of MFA, SAML, organizations, or lockout — it
would mean hand-building the four most security-sensitive pieces. Better Auth ships all of them as
first-party plugins (`two-factor`, `sso`, `organization`, rate limiting) and is explicitly named in
guide §5.2 as the greenfield alternative. Guide §5.4 check: actively maintained, MIT, no known
critical CVEs, substantial production adoption — but younger than Auth.js, so: version pinned
exactly, upgrades reviewed, and the session/authorization boundary kept behind our own
`requirePermission()` guard so a future swap touches one adapter. End-customer (widget) identity does
**not** use Better Auth — it is an anonymous, tenant+channel-scoped signed session token issued by
the Gateway Plane.

### 4.2a Deviation — UI: **Chakra UI** instead of Tailwind CSS + shadcn/ui

> **⚠️ Superseded by [ADR-0010](0010-admin-console-widget-shadcn-tailwind-migration.md) (2026-08-18).**
> This section is kept verbatim below as historical record of the original decision and its
> stated rationale. ADR-0010 reverses this choice for all three apps (`apps/web`,
> `packages/ui`, `apps/widget-embed` — the whole UI surface, not just the Admin Console) and
> corrects two factual points this section got wrong: (1) the actual pinned dependency
> throughout the project was **Chakra UI v2.10.4** (Emotion-based, no Ark UI anywhere in the
> dependency tree), not "v3, Ark UI primitives" as stated below; (2) the "runtime theming
> layer... materially better fit for FR-ADM-07" this section credits Chakra with was never
> actually implemented for the Admin Console — `AdminShell.tsx` applied tenant brand colors as
> raw inline hex props, not via `extendTheme`, so the theming-system advantage this deviation
> was justified on did not exist in practice. See ADR-0010 for the corrected rationale.

**Source of deviation (original, 2026-08-15):** user-specified (2026-08-15), overriding guide §5.2's Tailwind + shadcn/ui
default. Chakra UI (v3, Ark UI primitives underneath) ships accessible-by-default components
(keyboard + ARIA, satisfying NFR-7 the same way shadcn/ui's Radix base would have) and a runtime
theming layer — `extendTheme`/theme tokens — that is a materially better fit for FR-ADM-07's
per-tenant brand profile (primary/secondary color, font) than a Tailwind config compiled at build
time: the tenant brand profile is *data*, resolved per-request/per-tenant, not a value known at
build time, so it must be applied via a runtime theme provider regardless of styling library — Chakra
ships that mechanism first-party, where a Tailwind/shadcn build would need a parallel CSS-variable
injection layer to get the same behavior. Logical-property RTL support (NFR-8) is equivalent (Chakra
style props `ps`/`pe`/`ms`/`me` vs. Tailwind's `ps-*`/`pe-*`) — no NFR-8 regression. The embeddable
widget ships its own scoped Chakra theme/CSS build (as it would have with a scoped Tailwind build) so
host-page styles never leak in either direction. Trade-off accepted: Chakra's runtime CSS-in-JS
(Emotion-based) has a small bundle/perf cost Tailwind's static extraction avoids — acceptable given
the brand-theming requirement this decision exists to satisfy, and mitigated by the widget's separate,
size-budgeted build target (NFR-1).

### 4.3 Additions not named in guide §5 (each cleared against §5.4)

| Library / component | Purpose | §5.4 check |
|---|---|---|
| **ClickHouse** | Analytics + span store (ADR-0008) | Apache-2.0, active, very large production adoption |
| **Redis + BullMQ / Redis Streams** | Run queue, scheduled jobs, caches, quota counters, SSE fan-out | Guide's own Node default for jobs; Redis under RSALv2/SSPL — we use it only as an unmodified server, no redistribution, so the licence is not triggered. **Valkey (BSD) is a drop-in fallback if that changes.** |
| **`@modelcontextprotocol/sdk`** | MCP client (ADR-0004) | Official Anthropic SDK for the protocol the product is built on; no alternative exists |
| **`next-intl`** | i18n for 40+ locales incl. RTL (NFR-8) | MIT, active, App-Router-native |
| **`pgvector`** | KB retrieval inside Postgres, avoiding a separate vector DB (FR-KB-01) | PostgreSQL licence, active, ubiquitous |
| **`@node-saml/node-saml`** (if Better Auth's SSO plugin proves insufficient for a tenant's SAML dialect) | SAML SP fallback | MIT, maintained. Flagged as a contingency, not a Phase-1 dependency |
| **OpenTelemetry JS SDK + Collector** | NFR-9 | CNCF, mandated by NFR-9 in all but name |

## 5. Related decision — agent rollout is not a container deployment

NFR-2 requires rollback of a bad agent version in under 5 seconds. Container redeploys cannot meet
that. Therefore agent versions are **data**: the Deployment row's active version + traffic split is
read from the Redis-cached policy/deployment bundle at run start, and rollback is a row update plus a
pub/sub invalidation. `nexus-deploy` should not model agent versions as deployment artifacts.

## 6. Consequences

- Four images to build, scan, and roll; one migration job; one compose file for local dev.
- `nexus-deploy` must build **four** images per release and deploy one cell per region.
- The Gateway Plane needs a long graceful-drain window (in-flight tunnels/voice) and must be rolled
  before `runtime` and `web`.
- Redis is on the critical path for conversation flow (queue + policy cache); it needs HA in
  production, not a single node.
