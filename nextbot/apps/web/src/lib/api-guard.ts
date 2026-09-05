import "server-only";
import { NextResponse } from "next/server";
import { requirePermission } from "@nextbot/iam";
import { ForbiddenModuleError, SessionInvalidError, DomainError } from "@nextbot/contracts";
import { McpTransportError } from "@nextbot/mcp-client";
import type { PermissionLevelValue, RbacModuleValue } from "@nextbot/contracts";
import { getSession, getAuthContext, getSessionTenantContext } from "./session";

/**
 * Composition-root RBAC guard for `apps/web/app/api/v1/admin/**` route handlers.
 * `connectors`/`tool-registry` modules can't call `@nextbot/iam`'s
 * `requirePermission()` themselves (LLD §2.3's allow-list has no such edge) — this is
 * exactly the "apps are the composition root" seam the architecture reserves for
 * cross-cutting concerns like this.
 *
 * Phase 4 (BL-36, FR-SEC-10/FR-API-01) note: `@nextbot/iam` now also exposes
 * `verifyApiKey()`/`apps/web/src/lib/session.ts`'s `getAuthContext()` — a
 * service-account API key (`Authorization: Bearer nbk_…`) resolves to the exact
 * same `SessionClaims` shape a session cookie does, per LLD §5.1. This guard
 * deliberately keeps using the session-cookie-only `getSession()` — retrofitting
 * every existing `requireApi()`-gated route (connectors, tools, escalations, etc.)
 * to also accept a bearer key would be an undisclosed change to every `/admin`
 * route's own auth surface. Phase 18 (BL-49, FR-API-01) instead built a SEPARATE
 * `/api/v1/external/**` route tree, gated by `requirePublicApi()` below (the
 * bearer-key-accepting counterpart of this function) — every existing `/admin` route
 * using `requireApi()` is unaffected by that phase.
 *
 * @throws nothing — returns either the resolved `{ session, ctx }` or a `Response` to
 * return immediately (401/403), so callers do `const guard = await requireApi(...);
 * if (guard instanceof Response) return guard;`.
 */
export async function requireApi(module: RbacModuleValue, level: PermissionLevelValue) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  }
  try {
    requirePermission(session.permissions, module, level);
  } catch (err) {
    if (err instanceof ForbiddenModuleError) {
      return NextResponse.json({ type: "about:blank", title: err.message, status: 403, code: err.code }, { status: 403 });
    }
    throw err;
  }
  const ctx = await getSessionTenantContext(session);
  return { session, ctx };
}

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-01) — the bearer-key-accepting
 * counterpart of `requireApi()` above, for `apps/web/app/api/v1/external/**` route
 * handlers. This is `requireApi()`'s own doc comment's named destination: the ONLY
 * difference from `requireApi()` is `getAuthContext()` (session cookie OR
 * `Authorization: Bearer nbk_…`) instead of `getSession()` (cookie only) — the RBAC
 * check itself is the exact same `requirePermission(session.permissions, module,
 * level)` call, unmodified, which is the literal mechanism that satisfies FR-API-01's
 * "subject to the same permission-module gating as the console... not a side-door
 * around RBAC." `requireApi()` itself is deliberately left cookie-only (retrofitting
 * every existing `/admin` route to also accept a bearer key is a separate, larger,
 * undisclosed change this phase does not make — `/external` is the new bearer-key
 * surface, `/admin` is unchanged).
 *
 * @throws nothing — same calling convention as `requireApi()`.
 */
export async function requirePublicApi(module: RbacModuleValue, level: PermissionLevelValue) {
  const session = await getAuthContext();
  if (!session) {
    return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  }
  try {
    requirePermission(session.permissions, module, level);
  } catch (err) {
    if (err instanceof ForbiddenModuleError) {
      return NextResponse.json({ type: "about:blank", title: err.message, status: 403, code: err.code }, { status: 403 });
    }
    throw err;
  }
  const ctx = await getSessionTenantContext(session);
  return { session, ctx };
}

/** Maps a thrown `DomainError` to an RFC 9457 problem+json response (LLD §11.2). */
export function problemResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return NextResponse.json(
      { type: "about:blank", title: err.message, status: err.httpStatus, code: err.code, fields: err.fields },
      { status: err.httpStatus },
    );
  }
  if (err instanceof SessionInvalidError) {
    return NextResponse.json({ type: "about:blank", title: err.message, status: 401 }, { status: 401 });
  }
  if (err instanceof McpTransportError) {
    // FR-MCP-02: transport-level discovery failures are surfaced verbatim, never
    // wrapped behind a generic message.
    return NextResponse.json({ type: "about:blank", title: err.message, status: 502, code: "DISCOVERY_TRANSPORT_ERROR" }, { status: 502 });
  }
  // Never leak internal error detail to the client (security review requirement) —
  // the real message/stack goes to server-side logs only.
  console.error(err);
  return NextResponse.json({ type: "about:blank", title: "An unexpected error occurred.", status: 500 }, { status: 500 });
}
