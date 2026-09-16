/**
 * The authorization check.
 *
 * ADR-0006 rule 7: authorization is entirely separate from authentication.
 * Everything in this file reads `Principal.permissions` and `Principal.assurance`
 * and knows nothing about how either was established — so swapping
 * `LocalPasswordProvider` for `OidcProvider`, or the mock verifier for UAE PASS,
 * does not touch a line of it. That is the property the rule is asserting, and
 * this is the file where it is either true or not.
 *
 * ## Deny by default, and AND-only composition
 *
 * A required permission must be *present in the set*. There is no wildcard, no
 * role hierarchy and no implicit grant from one permission to another
 * (`domain/permissions.ts`). Composite requirements are an array evaluated as
 * **AND**; there is deliberately no OR form, because a route that would need one
 * is two routes (api.md §3.4). An OR would also make the B9 matrix screen a
 * partial account of who can do what, which is the failure mode the matrix exists
 * to prevent.
 *
 * ## Why this throws rather than returning a boolean
 *
 * A boolean can be ignored. `if (allowed)` with no `else` is a passing test and a
 * missing check, and it looks correct in review. Throwing means the only way past
 * this function is to be authorised.
 *
 * The inbound adapter calls this before any handler code and before any query
 * (api.md §12 invariant 2). Team and entity scope is a **second, separate** check
 * inside the use case: `agents:manage` says *may manage agents*, not *may manage
 * this entity's agents*.
 */

import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { isAllowed, PermissionDeniedError, type Permission } from "../domain/permissions.js";
import {
  AssuranceInsufficientError,
  satisfiesAssurance,
  type AssuranceLevel,
} from "../domain/assurance.js";

/**
 * Assert the principal holds every required permission.
 *
 * Evaluated in declaration order so the error names the first missing one, which
 * makes the message stable across runs — a set-iteration order would not be.
 */
export function requirePermission(
  principal: Principal,
  required: Permission | readonly Permission[],
  operation: string,
): void {
  const requirements = typeof required === "string" ? [required] : required;

  if (requirements.length === 0) {
    // An empty requirement would authorise everything, silently. api.md §12
    // invariant 2 says every backoffice route declares a permission; an empty
    // array is how that declaration gets accidentally satisfied.
    throw new Error(
      `"${operation}" declared an empty permission requirement. Every guarded operation ` +
        "names at least one permission from B9 tab 3 (api.md §12 invariant 2).",
    );
  }

  for (const permission of requirements) {
    if (!isAllowed(principal.permissions, permission)) {
      throw new PermissionDeniedError(permission, operation);
    }
  }
}

/**
 * Assert the principal's assurance satisfies the requirement.
 *
 * Citizens have no permissions — they have a level (api.md §3.5), so this is the
 * citizen-surface counterpart of `requirePermission` and not an addition to it.
 * A rank comparison, never an equality test: `L2` must satisfy an `L1` gate.
 */
export function requireAssurance(
  principal: Principal,
  required: AssuranceLevel,
  operation: string,
): void {
  if (!satisfiesAssurance(principal.assurance, required)) {
    throw new AssuranceInsufficientError(required, operation);
  }
}
