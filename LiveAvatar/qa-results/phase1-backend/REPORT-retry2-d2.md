# QA Retry 2 - D-2 Re-verification (LLD Sec3.4 ESLint layer/module boundaries)

**Date:** 2026-08-19
**Scope:** Narrow re-verification of D-2 fix claimed in `eslint.config.mjs` (round 2 dev
fix, three compounding root causes: missing import resolver, `basePath` cwd
mismatch, self-cancelling barrel/feature zones + Prisma `except` side).
**Verdict: PARTIALLY-FIXED**

## What was independently re-verified as genuinely fixed

1. **Import resolver.** `eslint-import-resolver-typescript@^4.4.5` is a real
   devDependency in root `package.json` and physically present in
   `node_modules/` and `pnpm-lock.yaml`. Both `apps/api` and `apps/web` config
   blocks in `eslint.config.mjs` carry `settings['import/resolver'].typescript`
   pointed at each app own `tsconfig.json`. Confirmed working: `.ts` imports
   now resolve (previously any path-based rule silently no-op'd on every `.ts`
   import).
2. **basePath cwd fix.** `workspaceRoot` is computed once via
   `dirname(fileURLToPath(import.meta.url))` and passed as `basePath` to both
   `import/no-restricted-paths` rule configs. Ran `pnpm lint` both from the
   repo root (`pnpm --filter ... lint`) and directly inside `apps/api`/`apps/web`
   - zones fire identically either way. Fixed.
3. **Cross-module barrel isolation (apps/api).** Per-module generated zones
   (`apiModules.map(...)`) genuinely work. Live-tested:
   - `tenants/domain/tenant.ts` importing `../../auth/domain/admin-identity`
     (deep cross-module import, bypassing the barrel) -> **1 real error**:
     `Unexpected path "../../auth/domain/admin-identity" imported in
     restricted zone  import/no-restricted-paths`.
   - The same file importing `../../auth` (the legal barrel, `AuthModule`) ->
     **0 errors**, confirmed clean.
   This is the correct behavior and matches the dev report's claim.
4. **Generated-Prisma-client zone.** Live-tested: importing
   `../../../generated/prisma/client` (real, resolvable path to the actual
   generated client - schema.prisma has no index.ts re-export, so the
   literal `.../generated/prisma` directory import used in the dev report's
   phrasing does not resolve at all and is a red herring either way) from
   `tenants/application/get-tenant.use-case.ts` (outside `common/prisma`) ->
   **1 real error**. Fixed and correctly targeted (target/except sides
   are the right way around).
5. **Cross-feature Angular import isolation (apps/web).** Per-feature generated
   zones (`webFeatures.map(...)`) genuinely work. Live-tested: importing
   `AUTH_ROUTES` from `../../../auth/auth.routes` inside
   `features/deployments/pages/deployments-list-page/deployments-list-page.component.ts`
   -> **1 real error**, correctly attributing the violating path.
6. **No false positives on the real codebase.** `pnpm lint` from repo root
   (`pnpm --filter @liveavatar/contracts lint && ... api lint && ... web
   lint`) and independently per-package inside apps/api / apps/web: **exit
   0, zero problems**, on the real, unmodified codebase both before and after
   all probes (probes were introduced and fully reverted between runs).

## New defect found - the six primary layer-isolation zones do not fire (any module, either app)

**This directly contradicts the dev fix report's claim that the real codebase and
its guardrails are at 0 violations and fully enforced** - the barrel/feature/Prisma
zones work, but the *foundational* domain/application/interface layer-separation zones
described in the LLD (and present in `eslint.config.mjs` lines 87-110, plus the
apps/web core->features zone at lines 182-185) are silently inert.

**Root cause:** every one of these zone `target` globs names only the bare layer
directory itself, with no `/**/*` suffix, e.g.:

    {
      target: './apps/api/src/modules/*/domain',
      from: './apps/api/src/modules/*/infrastructure',
    },

`import/no-restricted-paths` matches `target` against the *file path of the importing
file*, not its containing directory. A pattern with no `/**/*` only matches a path that
is *literally* `apps/api/src/modules/<x>/domain` - never a real `.ts` file, which is
always `apps/api/src/modules/<x>/domain/<file>.ts`. The zone therefore matches zero
files and never triggers, for any module, in any of the six affected zones. The exact
same bug is present in the analogous apps/web core -> features zone. Only the zones
the dev added/rewrote with a correct recursive glob (the per-module barrel zones, the
per-feature zones, and the Prisma zone, all of which use `!(...)`/`**/*` suffixes)
actually work.

**Live reproduction (3 independent cases, all in the currently-unmodified repo, each
probed then fully reverted):**

1. `apps/api/src/modules/tenants/domain/tenant.ts` - added
   `import { PrismaTenantRepository } from '../infrastructure/prisma-tenant.repository';`
   (a domain importing infrastructure **within the same module** - this is exactly the
   scenario the dev report's own "before/after lint proof" cites as now producing 1
   error). Ran `npx eslint src/modules/tenants/domain/tenant.ts` from apps/api:
   **0 problems, exit 0.** This is the rule that LLD Sec3.4 requires ("domain is pure -
   no infra/interface/application imports") and it does not fire.
2. `apps/api/src/modules/tenants/interface/tenants.controller.ts` - added the same
   import of `../infrastructure/prisma-tenant.repository` (interface importing
   infrastructure directly, bypassing application). `npx eslint
   src/modules/tenants/interface/tenants.controller.ts`: **0 problems, exit 0.**
3. `apps/web/projects/admin/src/app/core/auth/auth.store.ts` - added
   `import { DeploymentsService } from '../../features/deployments/services/deployments.service';`
   (core importing a feature, which the config's own comment says is forbidden).
   `npx eslint "projects/admin/src/app/core/auth/auth.store.ts"` from apps/web:
   **0 problems, exit 0.**

All three probes were reverted from backed-up originals immediately after
reproduction; `pnpm lint` at the repo root subsequently returned exit 0 with the
identical clean baseline, and a follow-up grep for "qaProbe" across apps/ plus a
find for stray .bak files came back clean (one .bak file was found and removed
before finishing - noted for hygiene, not a defect).

**Impact:** the LLD Sec3.4 layer-separation guarantee (domain pure; application must
not know persistence/HTTP; interface must not reach past application) that D-2 was
originally opened for is **still not enforced** for any of the 4 backend modules or the
web core layer - only the narrower "no reaching another module/feature except
through its barrel" rule is enforced. This is the same class of false-assurance risk
QA retry 1 flagged for D-2 originally (the guardrail is present in the config and reads
correctly, but does not fire), now narrowed to a specific and previously-unexamined
subset of the zones.

**Originating phase:** development (QA-driven fix pass round 2, BL-001-004) - this is
the same `eslint.config.mjs` edit dispatched to fix D-2; this is a genuine new gap
inside that fix, not a regression from anything else in this dispatch.

**Severity:** Medium-High - blocks D-2 from being closed as fully fixed. Does not
block a build/deploy (the rule fails silently rather than crashing anything, and no
real code in the current tree happens to violate it), but the requirement it exists to
enforce (LLD Sec3.4 layer isolation) has zero live enforcement for its 6 primary rules
across both apps.

## Regression re-run (backend + frontend), confirming no fallout from the config/lockfile/package.json changes

| Check | Result |
|---|---|
| apps/api - `prisma generate && nest build` | Clean, exit 0 |
| apps/api - `jest --runInBand` | 47/47 suites, 262/262 tests passed |
| apps/web - `jest --coverage` | 26/26 suites, 167/167 tests passed (shared-lib files at 100% stmts, consistent with prior reports) |
| apps/web - `ng build admin` | Clean, exit 0 (only pre-existing `@liveavatar/contracts is not ESM` warning, not new) |
| apps/web - `ng build conversation` | Clean, exit 0 |
| `pnpm lint` (root, all 3 packages) | Clean, exit 0, on unmodified codebase |

No regressions found in build/test surfaces from the eslint.config.mjs /
package.json / pnpm-lock.yaml changes.

## Traceability matrix

| Requirement / claim | Scenario tested | Result | Evidence |
|---|---|---|---|
| Resolver settings present and effective (both apps) | Read config; ran lint from repo root and from inside each app dir | PASS | eslint.config.mjs lines 57-65, 158-166; pnpm-lock.yaml entry; lint runs above |
| basePath fixes cwd-dependent zone resolution | Ran lint from both repo root and apps/* cwd | PASS | Identical zone-firing behavior both ways |
| Cross-module barrel zone (apps/api) fires on deep import, not on barrel | Deep import tenants/domain -> auth/domain/admin-identity; legal import via ../../auth | PASS | 1 error on deep import, 0 on barrel import |
| Generated-Prisma-client zone fires outside common/prisma | Import generated/prisma/client from tenants/application | PASS | 1 error |
| Cross-feature Angular zone fires (apps/web) | Import features/auth/auth.routes from features/deployments/... | PASS | 1 error |
| Domain layer purity - domain must not import infrastructure/interface/application (LLD Sec3.4, any module) | Same-module tenants/domain -> tenants/infrastructure import | FAIL | 0 errors - see "New defect" above |
| Interface layer must not reach past application into infrastructure (LLD Sec3.4) | Same-module tenants/interface -> tenants/infrastructure import | FAIL | 0 errors - see "New defect" above |
| apps/web core must not import features (LLD Sec3.4) | core/auth/auth.store.ts -> features/deployments/.../deployments.service.ts | FAIL | 0 errors - see "New defect" above |
| No false positives introduced on real codebase | Full pnpm lint before and after all probes | PASS | exit 0 both times |
| No regressions in backend/frontend build/test | Full jest + build re-run, both apps | PASS | See regression table |

## Verdict

**PARTIALLY-FIXED.**

- Genuinely fixed and verified: the import resolver, the basePath cwd bug, the
  cross-module barrel zones, the feature-isolation zones, and the Prisma-client zone -
  all four of the dev report's cited proof scenarios reproduce correctly.
- Still broken: the six primary LLD Sec3.4 layer-isolation zones (domain<->infrastructure/
  interface/application in apps/api, and core<->features in apps/web) - the
  requirement D-2 was originally raised for - do not fire for any module in either app,
  due to a missing recursive-glob suffix (/**/*) on their target patterns. This is a
  narrowly-scoped, mechanical fix (add /**/* to the 7 affected target entries and
  re-run the same live-probe proof this report used), not a design problem.

**Recommendation:** retry nexus-dev narrowly for this remaining gap only - do not
reopen the already-fixed resolver/basePath/barrel/Prisma/feature work, which is
correct and should not be touched. Re-verify with the same probes documented here
(same-module domain->infrastructure, interface->infrastructure, and apps/web
core->features) before closing D-2.
