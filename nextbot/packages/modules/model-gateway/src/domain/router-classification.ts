/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03, LLD §14.7.2) — the
 * "is this route cheap/router-class, or potentially a frontier model" check.
 * Originally written inline inside `@nextbot/teams`' `team-version-service.ts`
 * (`resolveArtifact`'s supervisor-route validation); extracted here in Phase 15
 * (BL-47a, LLD §14.6.3's `RouterNode.classifierRouteVersionId`) so a SECOND
 * artifact kind (a workflow's `Router` node in `Classifier` mode) can reuse the
 * EXACT SAME check rather than re-deriving an equivalent-looking comparison —
 * `teams` was refactored in place to call this function too, so there is now
 * exactly one place this decision is made for the whole codebase.
 *
 * Pure (`domain/`, no I/O) — the caller resolves the real `model_route` row first.
 */

/** The subset of a `model_route` row this check actually reads. */
export interface RouterClassRouteCandidate {
  role: string;
  name: string;
}

/** `"chat.router"` is Model Gateway v2's own router-role classification
 * (`model_route.role`) — reused rather than inventing a second router-
 * classification concept. A route also counts as router-class if it happens to be
 * NAMED `chat.router` even without the role set (the standard-routes seed's own
 * convention). */
const ROUTER_ROLE = "chat.router";
const ROUTER_NAME = "chat.router";

/**
 * `true` when `route` is safe to use as a cheap classification/routing decision —
 * `false` for anything unclassified, which is treated as POTENTIALLY frontier-class
 * (fail closed: an unclassified route is never assumed cheap).
 */
export function isRouterClassRoute(route: RouterClassRouteCandidate): boolean {
  return route.role === ROUTER_ROLE || route.name === ROUTER_NAME;
}
