/**
 * Screen 3 (Guardrails & policies) — pure value validation for a global `Policy.
 * defaultValueJson` write.
 *
 * Mirrors a real, already-shipped DB constraint rather than inventing a separate
 * notion of "valid": `CK_Policies_defaultValueJson_isJson CHECK (ISJSON(defaultValueJson)
 * = 1)` (`prisma/sql/001_constraints.sql`). B-5's own live-infra finding (`tasks/
 * lessons.md`, "SQLAlchemy's T-SQL dialect rejects several idioms...") is the reason every
 * value here is wrapped as `{"value": <scalar>}` rather than a bare `"true"`/`"0.6"`
 * string: SQL Server 2022's `ISJSON()` accepts only a real JSON object or array, never a
 * bare scalar — `scripts/seed-agent-runtime-demo-data.ts`'s own six `POLICIES` fixtures
 * already use this exact wrapper, confirmed by reading that script directly.
 */

/** The three `Policy.kind` values the real `CK_Policies_kind` constraint allows. */
export type PolicyKind = "Boolean" | "Threshold" | "Enum" | (string & {});

/**
 * Whether this screen renders a typed control for a policy's value, or falls back to a
 * raw, validated JSON textarea.
 *
 * Only `Boolean` (a `Switch`) and `Threshold` (a bounded decimal `Input`) get a typed
 * editor. `Enum` does not — `platform.Policies` carries no column naming an enum's real
 * option set anywhere in the schema (confirmed by reading `model Policy` directly), so
 * there is no closed vocabulary to build a real `<Select>` from; inventing one client-side
 * would be a guess, not a real control. And every real seeded policy today
 * (`seed-agent-runtime-demo-data.ts`'s six rows) is `Boolean` or `Threshold` — no `Enum`
 * row exists yet to design a typed control against empirically. A validated JSON textarea
 * is therefore the honest, general-purpose fallback for `Enum` and for any future kind
 * this schema has not seeded yet, rather than a third typed editor built against no real
 * data.
 */
export function hasTypedEditor(kind: string): kind is "Boolean" | "Threshold" {
  return kind === "Boolean" || kind === "Threshold";
}

/**
 * Unwraps `{"value": <scalar>}`. Returns `undefined` when `valueJson` does not parse, or
 * does not carry that exact shape — the caller (a typed editor's initial state) treats
 * that as "nothing to prefill," never as a thrown error, since a malformed stored value
 * should not crash the edit dialog that exists to fix it.
 */
export function unwrapPolicyValue(valueJson: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return (parsed as Record<string, unknown>).value;
}

/** Encodes a `Boolean`-kind value in the real, DB-accepted wrapper shape. */
export function encodeBooleanValue(value: boolean): string {
  return JSON.stringify({ value });
}

/** Encodes a `Threshold`-kind value in the real, DB-accepted wrapper shape. `TR_
 *  PolicyOverrides_respectFloor` reads a `Threshold` value's `$.value` as `decimal(9,4)` —
 *  this does not round or clamp, it only serializes what the caller already parsed. */
export function encodeThresholdValue(value: number): string {
  return JSON.stringify({ value });
}

/**
 * Parses a `Threshold` field's raw text input. `null` for anything that is not a finite
 * number — including blank text, so an emptied box refuses to submit rather than
 * silently coercing to `0`, matching `circuit-breakers-tab.tsx`'s own `parseWholeNumber`
 * precedent for the identical "don't coerce a blank box into a real value" reasoning.
 */
export function parseThresholdInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates a hand-typed JSON textarea value — the `Enum`/fallback editor's own submit
 * check — against the one real, DB-enforced shape rule every `Policy.defaultValueJson`
 * must satisfy: valid JSON, and a real object or array, never a bare scalar (the same
 * `ISJSON()` fact this module's own doc comment names). This is a client-side courtesy
 * only; `UpdateGuardrailPolicyValue` (application layer) re-validates the identical rule
 * server-side before ever reaching the repository, and the real DB constraint is the
 * final backstop regardless of what either layer does.
 */
export function isValidPolicyValueJsonText(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return parsed !== null && typeof parsed === "object";
}
