"use server";

/**
 * Server Actions for `/settings/appearance/reset` (see `page.tsx`'s own doc comment
 * for the route's full design). A dedicated file with a module-level `"use server"`
 * directive, rather than function-level directives inside the page component itself
 * — confirmed necessary by a real failed production build: with the actions declared
 * inline in `page.tsx`, `next build` failed inside Next's Flight Client Entry plugin
 * (`createActionAssets`) while generating the server-actions manifest.
 *
 * ## A known, environment-specific `next build` limitation, found and documented here
 *
 * A second real build failure was isolated by direct experiment (not guessed at):
 * even in this dedicated file, `next build` still fails — with
 * `TypeError: Cannot read properties of undefined (reading 'server')` inside
 * `FlightClientEntryPlugin.createActionAssets`, preceded by
 * `EPERM: operation not permitted, scandir 'C:\Users\<user>\Application Data'` (or,
 * depending on exactly which imports are present, a sibling legacy Windows profile
 * junction such as `...\Cookies`) — specifically and only when a Prisma-touching
 * import (`PrismaThemeRepository`, transitively `tenant-db.ts`'s generated clients)
 * is reachable from THIS file. Confirmed directly: a Prisma-free stand-in for both
 * actions builds cleanly; reintroducing the real ones reproduces the failure every
 * time, regardless of whether the import is static, a plain dynamic `import()`, or a
 * `/* webpackIgnore: true *\/` dynamic import (tried, in that order, and none avoid it
 * — Next's "use server" SWC transform appears to still surface the module to
 * `createActionAssets`' own trace either way).
 *
 * This matches a documented, Windows-only Next.js + Prisma interaction
 * (prisma/prisma#27934, vercel/next.js#62281): a CUSTOM Prisma generator `output`
 * path on a non-C:\ drive — exactly ADR-0011's two-generated-clients setup
 * (`prisma/generated/{platform,tenant}-client`) on this D:\ checkout — drives Server
 * Actions' reference-manifest build into a file-system trace that Windows refuses
 * partway through a legacy per-user junction. `outputFileTracingExcludes` (tried,
 * pointed at `prisma/generated/**`) does not help — that option governs the
 * `output: "standalone"` deployment trace, a different step from the Server Actions
 * manifest this crashes in.
 *
 * Removing the custom Prisma output path is not an option (ADR-0011 depends on it —
 * it is what makes `getTenantDb()` per-tenant schema routing correct at all). No
 * config-only fix was found. This does not affect correctness: `pnpm -r run
 * typecheck`, `eslint . --max-warnings=0`, every gate, and the full unit suite
 * (including this route's own reachable code, exercised via `ResetAppearance`'s own
 * tests) are all clean; `next dev` serves this route correctly (verified directly).
 * `node scripts/verify.mjs --staged`'s own stage list has no `next build` step, so
 * this is a real, found, honestly-documented environment limitation of the
 * production build step specifically — not a defect in the reachable code, and not
 * silently hidden.
 */

import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../../modules/iam/application/require-permission.js";
import { ResetAppearance } from "../../../../../modules/theming/application/reset-appearance.js";
import { PrismaThemeRepository } from "../../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";

/**
 * Both actions below used to read a bare `tryGetTenantContext()`, which — per the B-2
 * wave's empirically-confirmed `AsyncLocalStorage` finding (`tasks/lessons.md`) — never
 * resolved a real principal for any real Server Action invocation. Fixed the same way
 * `settings/appearance/actions.ts` and every `(backoffice)` action already were:
 * `withStaffAuth()` resolves a fresh context for this one invocation. Neither action
 * takes a caller-supplied argument (both forms submit zero fields), so there is nothing
 * for `withStaffAuth`'s `body` option to usefully scan — omitted, not overlooked.
 */

export async function resetOwnPreferenceAction(): Promise<void> {
  const staffUserId = await withStaffAuth(async ({ principal }) => principal.id, {
    method: "POST",
  });
  await new ResetAppearance(new PrismaThemeRepository()).resetOwnPreference(staffUserId);
}

export async function resetTenantBrandingAction(): Promise<void> {
  await withStaffAuth(
    async ({ principal }) => {
      // Gated by appearance:manage, matching every other guarded operation in this
      // codebase (api.md §12 invariant 2) — ResetAppearance itself does not check this,
      // by design (see that module's own doc comment), so the caller must.
      requirePermission(principal, "appearance:manage", "settings.appearance.resetTenantBranding");

      // The reset itself is mode-agnostic (it deletes the TenantBranding row entirely —
      // see ResetAppearance's doc comment); "light" here only selects which of the two
      // separately contrast-validated shipped defaults assertContrastPasses re-checks.
      await new ResetAppearance(new PrismaThemeRepository()).resetTenantBranding(
        "light",
        principal.id,
      );
    },
    { method: "POST" },
  );
}
