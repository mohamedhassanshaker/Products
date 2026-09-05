import "server-only";
import crypto from "node:crypto";

/**
 * Core primitives behind `requirePlatformApi()` (`platform-api-guard.ts`, the
 * `/api/internal/ops/**` route guard) and the `/internal/ops/**` page-side gates
 * (`ops-page-gate.ts`, every ops page/layout) — kept in one place so both call sites
 * check the exact same env vars/logic instead of two independently maintained copies
 * drifting apart.
 *
 * Deliberately NOT reusing `apps/web/src/lib/api-guard.ts`'s `requireApi()` — this is
 * a wholly different trust model (a shared operator secret + network allowlist, not
 * a per-user session/RBAC check), per the Platform Manager console plan's explicit
 * design decision (a documented deviation from LLD §11.3's "separate operator IdP",
 * chosen as a pragmatic MVP rather than standing up a second IdP).
 *
 * ## Split with `platform-ops-network.ts`
 *
 * The configured-check, the CIDR allowlist matcher and the trusted-proxy IP resolution
 * now live in `platform-ops-network.ts` and are **re-exported verbatim from here**, so
 * every existing importer of this module keeps working unchanged. The split exists
 * because `middleware.ts` needs those three and runs in the Edge runtime, which cannot
 * load this file at all: `node:crypto` (below) and `server-only` (above) are both
 * unavailable there. Nothing about their behaviour changed in the move.
 *
 * What stays here is everything that genuinely needs Node or a server-component
 * context: the operator-token comparison and the two shared constants.
 */

export { extractClientIp, isIpAllowed, isPlatformOpsConfigured, isRequestFromAllowedNetwork } from "./platform-ops-network.js";

/** The httpOnly cookie the `/internal/ops/login` Server Action sets on a valid
 * token — scoped to `/` (see the QA retry 1 Defect 3 note in the plan doc: the
 * sibling `/api/internal/ops/**` handlers need it too). Its value is the operator
 * token itself: verifying a cookie-based request is byte-for-byte the same check as
 * verifying an `Authorization: Bearer` header, so there is exactly one verification
 * code path for both. */
export const OPS_SESSION_COOKIE = "nb_ops_session";

/** The fixed attribution label written to `platform_audit_log_entry` for actions
 * taken through this console. The shared-token auth model (deliberately, see the
 * plan doc) has no per-operator identity to attribute to more specifically than
 * this — a real per-operator identity would require standing up the separate
 * operator IdP LLD §11.3 originally specified, out of this MVP's scope. */
export const PLATFORM_OPERATOR_ACTOR_LABEL = "platform-operator";

/**
 * Constant-time token comparison. Compares SHA-256 digests (fixed 32-byte length)
 * rather than the raw candidate/expected strings directly — `crypto.timingSafeEqual`
 * throws on a length mismatch, which a naive direct comparison would need to guard
 * with a length check first (itself a timing/short-circuit leak of the expected
 * token's length); hashing first sidesteps that entirely; the digest comparison
 * itself remains constant-time.
 *
 * Returns `false` (never throws) when the console isn't configured at all, so every
 * caller can treat "unconfigured" and "wrong token" identically.
 */
export function verifyOperatorToken(candidate: string): boolean {
  const expected = process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
  if (!expected || !candidate) return false;
  const candidateDigest = crypto.createHash("sha256").update(candidate).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(candidateDigest, expectedDigest);
}
