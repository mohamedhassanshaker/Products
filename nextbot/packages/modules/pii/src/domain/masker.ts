/**
 * Phase 17 (BL-10, FR-SEC-04) — PII detection + masking. Pure functions, no I/O
 * (LLD §2.2: domain logic belongs in `domain/`, DB-backed policy lookup is a
 * separate `application/` concern that supplies the `PolicyLookup` this module
 * consumes).
 */

export type PiiEntityType =
  | "NationalId"
  | "CreditCard"
  | "IBAN"
  | "Phone"
  | "Email"
  | "Passport"
  | "DateOfBirth"
  | "Custom";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — `"Knowledge"` added:
 * the masking-context matrix now also governs `knowledge_chunk.text`, resolved
 * against `(entityType, "Knowledge", trustLevel)` at BOTH index time (the
 * collection's own configured trust level) and read time (the requesting agent's
 * own trust level) — see `@nextbot/knowledge`'s `pii-reeval-service.ts`.
 */
export type PiiContext = "Transcript" | "ToolCallPayload" | "A2APayload" | "Export" | "HumanAgentView" | "Knowledge";

export type ConnectorTrustLevel = "Trusted" | "SemiTrusted" | "Untrusted";

export type PiiMaskAction = "Show" | "PartialMask" | "FullMask" | "Redact";

export interface CustomPiiRule {
  entityType: "Custom";
  label: string;
  pattern: string;
}

export interface DetectedEntity {
  entityType: PiiEntityType;
  label: string;
  start: number;
  end: number;
  value: string;
}

/**
 * Built-in detectors for the seven fixed entity types (FR-SEC-04). Deliberately
 * conservative regexes tuned for low false-positive rate over exhaustive recall —
 * this is a masking backstop, not a validator; a missed detection is worse than an
 * occasional over-match on already-plausible-looking text.
 */
const BUILT_IN_PATTERNS: Array<{ entityType: PiiEntityType; regex: RegExp }> = [
  // UAE Emirates ID / generic 15-digit national ID: 784-YYYY-NNNNNNN-N or 15 digits.
  { entityType: "NationalId", regex: /\b\d{3}-?\d{4}-?\d{7}-?\d{1}\b/g },
  // Credit card: 13-19 digits, optionally grouped by spaces/dashes in 4s.
  { entityType: "CreditCard", regex: /\b(?:\d[ -]?){13,19}\b/g },
  // IBAN: 2 letters + 2 digits + up to 30 alphanumeric.
  { entityType: "IBAN", regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g },
  // E.164-ish phone number.
  { entityType: "Phone", regex: /\b\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g },
  { entityType: "Email", regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // Passport: 1-2 letters + 6-9 digits (broad international convention).
  { entityType: "Passport", regex: /\b[A-Z]{1,2}\d{6,9}\b/g },
  // Date of birth: ISO or DD/MM/YYYY-ish.
  { entityType: "DateOfBirth", regex: /\b(?:\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/g },
];

/**
 * Runs every enabled built-in detector plus any tenant-authored `Custom` regex
 * rules against `text`, returning every match found (unsorted overlaps are
 * possible across entity types; `maskText` resolves overlap by mask-priority
 * order, most-specific first).
 */
export function detectPii(text: string, customRules: CustomPiiRule[] = [], enabledTypes?: Set<PiiEntityType>): DetectedEntity[] {
  const found: DetectedEntity[] = [];
  for (const { entityType, regex } of BUILT_IN_PATTERNS) {
    if (enabledTypes && !enabledTypes.has(entityType)) continue;
    for (const match of text.matchAll(regex)) {
      if (match.index === undefined) continue;
      found.push({ entityType, label: entityType, start: match.index, end: match.index + match[0].length, value: match[0] });
    }
  }
  for (const rule of customRules) {
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "g");
    } catch {
      // An invalid tenant-authored regex must never crash the masker — skip it
      // (surfaced as an authoring-time validation error elsewhere, not here).
      continue;
    }
    for (const match of text.matchAll(regex)) {
      if (match.index === undefined) continue;
      found.push({ entityType: "Custom", label: rule.label, start: match.index, end: match.index + match[0].length, value: match[0] });
    }
  }
  return found;
}

/** Resolves the mask action for one `(entityType, context, trustLevel)` triple.
 * Fails closed: an unconfigured combination defaults to `FullMask`, never `Show` —
 * an admin must explicitly opt a combination into laxer handling. */
export type PolicyLookup = (entityType: PiiEntityType, context: PiiContext, trustLevel: ConnectorTrustLevel) => PiiMaskAction | undefined;

function applyMaskAction(value: string, action: PiiMaskAction): string {
  switch (action) {
    case "Show":
      return value;
    case "Redact":
      return "[REDACTED]";
    case "FullMask":
      return "*".repeat(value.length);
    case "PartialMask": {
      // Shows only the last 4 characters — the conventional "•••• 1234" pattern —
      // masking everything else.
      if (value.length <= 4) return "*".repeat(value.length);
      return "*".repeat(value.length - 4) + value.slice(-4);
    }
  }
}

/**
 * Masks every detected PII entity in `text` per the resolved policy for
 * `(context, trustLevel)`. Overlapping matches are resolved by processing
 * highest-`start`-first (right-to-left) so earlier replacements never shift the
 * indices of matches still to be applied.
 */
export function maskText(
  text: string,
  entities: DetectedEntity[],
  context: PiiContext,
  trustLevel: ConnectorTrustLevel,
  resolvePolicy: PolicyLookup,
): string {
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let result = text;
  for (const entity of sorted) {
    const action = resolvePolicy(entity.entityType, context, trustLevel) ?? "FullMask";
    const masked = applyMaskAction(entity.value, action);
    result = result.slice(0, entity.start) + masked + result.slice(entity.end);
  }
  return result;
}

/** Convenience one-shot: detect + mask in one call, using only built-in detectors
 * (no custom rules) — what the audit-log read path and export path use. */
export function detectAndMask(
  text: string,
  context: PiiContext,
  trustLevel: ConnectorTrustLevel,
  resolvePolicy: PolicyLookup,
  customRules: CustomPiiRule[] = [],
): string {
  const entities = detectPii(text, customRules);
  return maskText(text, entities, context, trustLevel, resolvePolicy);
}

/** Recursively masks every string value in a JSON-shaped object/array — used for
 * tool-call payloads and audit `details` blobs, which are structured, not raw text. */
export function maskJsonValue(
  value: unknown,
  context: PiiContext,
  trustLevel: ConnectorTrustLevel,
  resolvePolicy: PolicyLookup,
  customRules: CustomPiiRule[] = [],
): unknown {
  if (typeof value === "string") {
    return detectAndMask(value, context, trustLevel, resolvePolicy, customRules);
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskJsonValue(v, context, trustLevel, resolvePolicy, customRules));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        maskJsonValue(v, context, trustLevel, resolvePolicy, customRules),
      ]),
    );
  }
  return value;
}
