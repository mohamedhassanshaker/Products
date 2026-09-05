import { ValidationFailedError } from '@/server/common/errors/domain-error';

/** Minimal, hand-rolled request-body validation (no `class-validator`/API-layer equivalent exists in
 * this app) — every Route Handler that accepts a JSON body uses these helpers rather than trusting
 * client-supplied shapes, matching the security requirement that every input is validated
 * server-side (type/length/range) before use. Field names match legacy's DTOs exactly (`email`,
 * `password`, `firstName`, `lastName`, `idToken`, `token`, `newPassword`, `currentPassword`) since
 * those are part of the wire contract; the exact bounds-violation wording is this port's own (not
 * byte-identical to legacy's class-validator messages) since only the `VALIDATION_FAILED` code and
 * field names are part of the tested contract, not the prose. */

/** Parses the request body as JSON, returning `{}` for an empty/malformed body rather than throwing —
 * callers then get a clean `VALIDATION_FAILED` for each missing required field instead of a raw JSON
 * parse error leaking to the client. */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function requireString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  const min = opts.min ?? 1;
  const max = opts.max ?? 200;
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new ValidationFailedError([{ field, constraint: `${field} must be a string between ${min} and ${max} characters.` }]);
  }
  return value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireEmail(value: unknown, field = 'email'): string {
  const str = requireString(value, field, { min: 1, max: 320 });
  if (!EMAIL_PATTERN.test(str)) {
    throw new ValidationFailedError([{ field, constraint: `${field} must be a valid email address.` }]);
  }
  return str;
}

/** `undefined`/absent stays `undefined` (leaves the field unchanged on a `PATCH`); any other value must
 * satisfy {@link requireString}'s own bounds — added Phase 2 sub-slice "2b" for the catalog CRUD
 * routes' optional-field `PATCH` bodies (`UpdateFeatureDto`/`UpdatePackageDto`/`UpdateAiModelDto`'s
 * "every field optional, `undefined` leaves it unchanged" convention, ported without a
 * `class-validator`-equivalent DTO layer). */
export function optionalString(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field, opts);
}

/** Required non-negative integer (whole-cent price amounts, sort order) — rejects a float, `NaN`, or
 * out-of-range value with the shared `VALIDATION_FAILED` code rather than silently coercing/truncating
 * a malformed client value. */
export function requireInt(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const min = opts.min ?? 0;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationFailedError([{ field, constraint: `${field} must be an integer between ${min} and ${max}.` }]);
  }
  return value;
}

/** `undefined`/absent stays `undefined`; any other value must satisfy {@link requireInt}. */
export function optionalInt(value: unknown, field: string, opts: { min?: number; max?: number } = {}): number | undefined {
  if (value === undefined) return undefined;
  return requireInt(value, field, opts);
}

/** `undefined`/absent stays `undefined`; any other value must be a genuine boolean (never a truthy
 * string like `"true"` — a client-side bug sending the wrong JSON type should fail loudly, not be
 * silently coerced). */
export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new ValidationFailedError([{ field, constraint: `${field} must be a boolean.` }]);
  }
  return value;
}

/** Required integer from a URL query-string parameter (e.g. `?educationLevelId=`/`?stageId=`) — added
 * Phase 3 for `taxonomy`'s parent-scoped list routes, the first shape in this app whose required
 * numeric input arrives via `searchParams` rather than a JSON body (`requireInt`) or an already-
 * well-formed path segment. `raw === null` (the param was never sent at all) and a non-numeric/
 * non-integer string are both rejected identically via {@link requireInt}'s own bounds check — passing
 * `undefined` rather than `Number(null)` (which would incorrectly evaluate to `0`) is what makes a
 * missing param fail loudly instead of silently resolving to id `0`. */
export function requireIntFromQuery(raw: string | null, field: string, opts: { min?: number; max?: number } = {}): number {
  return requireInt(raw === null || raw.trim() === '' ? undefined : Number(raw), field, opts);
}

/** Required value that must be one of `allowed` — used for `feature.resetPeriod`
 * (`'NONE' | 'DAILY' | 'MONTHLY'`), the one enum-shaped required field this dispatch's catalog CRUD
 * routes accept. */
export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationFailedError([{ field, constraint: `${field} must be one of: ${allowed.join(', ')}.` }]);
  }
  return value as T;
}
