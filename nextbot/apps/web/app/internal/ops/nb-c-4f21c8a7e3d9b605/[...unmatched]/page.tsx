import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { notFound } from "next/navigation";

/**
 * Catch-all for every console path this app does **not** implement.
 *
 * Next's App Router resolves static and named-dynamic segments ahead of a catch-all, so
 * the real console routes (`login`, `tenants`, `tenants/new`, `tenants/[id]`) still win;
 * this file only ever renders for a path that genuinely has no page.
 *
 * ## Why it exists (NFR-11, page-surface Defect 1)
 *
 * Page-surface twin of `app/api/[...unmatched]/route.ts`, and a second line of defence
 * behind `middleware.ts`. Only requests middleware deliberately rewrote onto this subtree
 * reach here at all (a denied caller's `/internal/ops/**` request is never rewritten, and
 * so is answered by the app-wide not-found for a path that has no route — see
 * `src/lib/ops-console-route.ts`). What this adds is that a mistyped path *inside* the
 * console still goes through the *same* `assertOpsPageAllowed()` gate, in the *same*
 * position in the tree, as a real page — so if the middleware layer is ever bypassed and
 * this subtree is reached directly, a denied real page and a denied nonexistent one are
 * still answered by the same code emitting the same not-found signal, rather than by two
 * different render paths whose outputs can be diffed. Without it, a nonexistent path here
 * would fall out of this segment entirely and never run the gate at all.
 *
 * It never renders content of its own in *any* case: even for a fully authorized operator
 * who mistypes a console URL, it answers `notFound()` so the response is the app's one
 * shared not-found page. It sits outside the `(console)` route group on purpose — it must
 * not acquire that group's session gate, since a redirect-to-login here would give
 * nonexistent paths a distinguishable response of their own.
 *
 * `force-dynamic` keeps it off the static-prerender path. A prerendered catch-all would be
 * served from a file with its own `ETag`/fixed `Content-Length`, giving nonexistent ops
 * paths a header shape that a per-request gate denial could never match.
 */
export const dynamic = "force-dynamic";

/**
 * @returns Never returns — always throws the App Router's not-found signal, so the
 *   shared root boundary (`app/not-found.tsx`) renders the response. Takes no route
 *   params: nothing about the answer may depend on the requested path.
 */
export default async function OpsUnmatchedPage() {
  await assertOpsPageAllowed();
  notFound();
}
