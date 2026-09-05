# NextBot Public API (FR-API-01)

`public-api-v1.yaml` documents the bearer-key-authenticated `/api/v1/external/**`
surface added in Target Architecture Blueprint Phase 18 (BL-49). It is hand-maintained
against this package's own TypeBox request/response schemas (`packages/contracts/src`)
— no OpenAPI auto-generation tool is configured in this workspace (BL-18's Developer
Portal, which would have been the natural home for a generated/interactive reference,
was never built; see `docs/plans/public-api-webhooks-otel-siem-plan.md`'s investigation
findings). Keep this document and the corresponding route/contract files in sync when
either changes.

Authentication: `Authorization: Bearer nbk_<tenantSlug>.<keyId>.<secret>` — a scoped
service-account API key, issued from Settings -> Service Accounts. See
`apps/web/src/lib/api-guard.ts#requirePublicApi` for the exact RBAC enforcement (the
same `requirePermission()` check every console route uses).
