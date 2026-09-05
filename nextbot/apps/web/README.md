# nextbot-web

CONTROL PLANE — all 5 portals + `/api/v1` config APIs + `/.well-known` (LLD §2.1).

Reserved scaffold as of Phase 0. `app/api/internal/ops/` is pre-created (empty) because
it is one of the two call sites `.dependency-cruiser.cjs`'s
`no-platform-outside-allowed-callers` rule allow-lists for `withPlatform` — the folder
needs to exist at that exact path once Phase 3/18 add real route handlers there.
