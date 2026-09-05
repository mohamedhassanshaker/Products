# QA Final Confirmation Pass - ESLint `import/no-restricted-paths` (D-2 closure), BL-001-004

**Scope**: narrow re-verification per orchestrator dispatch - confirm the round-3
dev fix (decision log 2026-08-19 "development (QA-driven fix pass round 3, final
targeted)") genuinely closes D-2 by adding the recursive `/**/*` suffix to both
`target` and `from` on all 7 previously-inert `import/no-restricted-paths` zones,
plus a full regression re-run (backend + frontend test/lint/build) and browser
verification of D-7/D-6 (reported separately in
`qa-results/phase1-admin-spa/REPORT-final.md`).

This is the fourth QA pass over the same file (`eslint.config.mjs`); prior passes
found: resolver missing entirely -> added; `basePath` cwd-dependence -> fixed;
barrel/feature zones self-cancelling -> rewritten as generated per-module/
per-feature zones -> verified live; then in retry 2, the 6 primary layer zones +
1 core->features zone found still inert because `target` (and, it turned out,
`from`) lacked the `/**/*` recursive suffix. This pass verifies that specific fix.

## 1. Static confirmation - `eslint.config.mjs`

Read the file directly. All 7 zones now carry `/**/*` on **both** `target` and
`from`:

| # | Zone | target | from |
|---|---|---|---|
| 1 | apps/api domain <- infrastructure | `./apps/api/src/modules/*/domain/**/*` | `./apps/api/src/modules/*/infrastructure/**/*` |
| 2 | apps/api domain <- interface | `./apps/api/src/modules/*/domain/**/*` | `./apps/api/src/modules/*/interface/**/*` |
| 3 | apps/api domain <- application | `./apps/api/src/modules/*/domain/**/*` | `./apps/api/src/modules/*/application/**/*` |
| 4 | apps/api application <- infrastructure | `./apps/api/src/modules/*/application/**/*` | `./apps/api/src/modules/*/infrastructure/**/*` |
| 5 | apps/api application <- interface | `./apps/api/src/modules/*/application/**/*` | `./apps/api/src/modules/*/interface/**/*` |
| 6 | apps/api interface <- infrastructure | `./apps/api/src/modules/*/interface/**/*` | `./apps/api/src/modules/*/infrastructure/**/*` |
| 7 | apps/web core <- features | `./apps/web/projects/*/src/app/core/**/*` | `./apps/web/projects/*/src/app/features/**/*` |

A code comment above the zone list now documents the requirement ("every
`target`/`from` below must carry a recursive `/**/*` suffix ... or the zone
matches zero files and silently enforces nothing") so the regression is less
likely to recur unnoticed.

## 2. Live probes - deliberate violations, different files/modules than the prior round

Prior rounds probed `tenants` (domain->infrastructure, interface->infrastructure)
and one `admin/core/auth` -> `features/deployments` case. This pass deliberately
used different modules/files to avoid re-testing only the previously-checked
paths:

| Zone probed | File | Import added | Result |
|---|---|---|---|
| domain <- interface (apps/api, `auth` module) | `apps/api/src/modules/auth/domain/admin-identity.ts` | `import { AuthController } from '../interface/auth.controller';` | **Fired**: `Unexpected path "../interface/auth.controller" imported in restricted zone import/no-restricted-paths` |
| application <- infrastructure (apps/api, `admin-users` module) | `apps/api/src/modules/admin-users/application/accept-invite.use-case.ts` | `import { PrismaInviteRepository } from '../infrastructure/prisma-invite.repository';` | **Fired**, same rule/message |
| interface <- infrastructure (apps/api, `platform` module) | `apps/api/src/modules/platform/interface/health.controller.ts` | `import { EnvLoader } from '../infrastructure/env-loader';` | **Fired**, same rule/message |
| core <- features (apps/web, `admin` project, `layout` sub-dir of core) | `apps/web/projects/admin/src/app/core/layout/shell.component.ts` | `import { DeploymentsService } from '../../features/deployments/services/deployments.service';` | **Fired**, same rule/message |

Ran `pnpm --filter @liveavatar/api lint` and `pnpm --filter @liveavatar/web lint`
with the 4 probes in place (each import intentionally left otherwise unused so
`@typescript-eslint/no-unused-vars` co-fires - expected noise, not a false
result): 6 errors on the api side (3 x `import/no-restricted-paths` + 3 x
unused-var), 2 errors on the web side (1 x each) - all 4
`import/no-restricted-paths` violations reproduced exactly as expected.

Reverted all 4 probes immediately after (single-line `sed` delete of the added
import line in each file); confirmed each file's first line matches its original
content by direct `head -2` inspection post-revert. No probe artifacts remain.

## 3. Full `pnpm lint` on the real, unmodified codebase

After removing all probes: `pnpm lint` (contracts -> api -> web in sequence) -
**exit 0, zero problems reported across all three packages.** This confirms:
- No new false positives were introduced by the `/**/*` suffix fix.
- The barrel/feature/Prisma zones verified correct in the prior two rounds still
  pass all legitimate code in the real codebase (same-module imports via
  barrels, intra-feature imports, `common/prisma`-scoped Prisma Client usage).

## 4. Full regression

Backend (`apps/api`):
- `pnpm jest --runInBand`: **47/47 suites, 262/262 tests passing.**
- `prisma generate && nest build` (via `pnpm run build`): clean, no errors.

Frontend (`apps/web`):
- `pnpm jest --coverage`: **26/26 suites, 167/167 tests passing.**
- `ng build admin`: clean (one pre-existing, unrelated warning: `@liveavatar/contracts`
  is CommonJS/not-ESM - present in prior QA rounds too, not introduced by this
  change, not a lint/test/build failure).
- `ng build conversation`: clean.

No regressions found. Numbers match the dev agent's claimed 47/262 and 26/167
exactly.

## Traceability matrix

| Requirement | Scenario | Result | Evidence |
|---|---|---|---|
| D-2 (7 ESLint zones must actually fire) | Static read of `eslint.config.mjs`: all 7 zones carry `/**/*` on target+from | PASS | Section 1 above |
| D-2 (zones fire on real violations) | 4 live probes across domain/interface/infrastructure/application (api) and core/features (web), on different files than prior rounds | PASS - all 4 fired | Section 2 above |
| D-2 (no new false positives) | Full `pnpm lint` on real codebase, probes removed | PASS - exit 0, 0 problems | Section 3 above |
| D-2 (prior barrel/feature/Prisma work not regressed) | Same `pnpm lint` run covers those zones on real code | PASS | Section 3 above |
| Backend regression | `jest --runInBand`, `prisma generate && nest build` | PASS - 47/47, 262/262, clean build | Section 4 above |
| Frontend regression | `jest --coverage`, `ng build admin`, `ng build conversation` | PASS - 26/26, 167/167, clean builds | Section 4 above |

## Defects

None found in this pass. D-2 is confirmed genuinely fixed.

## Verdict (this file's scope)

**D-2: FIXED**, confirmed independently with live negative-control probes on
modules/zones not previously probed, a clean full-codebase lint, and a clean
full regression run. No new defects introduced. See
`qa-results/phase1-admin-spa/REPORT-final.md` for the D-7/D-6 browser
verification and the combined Phase 1 verdict.
