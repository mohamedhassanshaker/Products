/**
 * QA Defect U10: `@hookform/resolvers/typebox`'s TypeBox/Ajv-driven resolver surfaces
 * raw validator messages verbatim (e.g. "Expected string length greater or equal to
 * 1", "Expected union value", "Expected string to match '^https://'") — accurate for
 * a developer, meaningless for an end user. This maps a raw message to human copy
 * **at the form layer only** — the underlying TypeBox schemas (`@nextbot/contracts`)
 * are untouched; a field/message pair with no mapping falls back to the raw message
 * rather than being silently swallowed, so an unmapped validator is still visible.
 */
const FIELD_MESSAGE_PATTERNS: Record<string, Array<[RegExp, string]>> = {
  name: [[/length greater or equal to 1/i, "Name is required."]],
  backendType: [[/union value/i, "Choose a backend type."]],
  environment: [[/union value/i, "Choose an environment."]],
  transport: [[/union value/i, "Choose a transport."]],
  authMethod: [[/union value/i, "Choose an authentication method."]],
  endpointUrl: [
    [/match '\^https:\/\//i, "Enter a valid https:// URL."],
    [/length greater or equal to 1/i, "Endpoint URL is required."],
  ],
  credentialPlaintext: [[/length greater or equal to 1/i, "Enter the credential value."]],
  // Phase 9 (client-feedback-batch item 7) — `DesignModeForm.tsx`'s structured fields,
  // validated by the same `@hookform/resolvers/typebox` resolver as every other RHF
  // form in this codebase, so its raw TypeBox messages need the same humanization.
  graphType: [[/union value/i, "Choose a graph type."]],
  modelRoute: [[/length greater or equal to 1/i, "Model route is required."]],
  instructions: [[/length greater or equal to 1/i, "System instructions are required."]],
  toolPolicyMaxToolCallsPerTurn: [
    [/greater or equal to 1/i, "Enter a whole number of at least 1."],
    [/expected integer/i, "Enter a whole number."],
  ],
  guardrailsMinConfidenceForAutonomy: [
    [/greater or equal to 0/i, "Enter a value between 0 and 1."],
    [/less or equal to 1/i, "Enter a value between 0 and 1."],
  ],
  memoryStrategy: [[/union value|length greater or equal to 1/i, "Choose a memory strategy."]],
  memoryMaxTurns: [
    [/greater or equal to 1/i, "Enter a whole number of at least 1."],
    [/expected integer/i, "Enter a whole number."],
  ],
  budgetsMaxCostUsdPerConversation: [[/length greater or equal to 1/i, "Enter a maximum cost."]],
  budgetsMaxLatencyMsP95: [
    [/greater or equal to 0/i, "Enter a latency of 0 or more."],
    [/expected integer/i, "Enter a whole number."],
  ],
};

/**
 * @param field the form field name (used to disambiguate what a generic validator
 *   message like "length greater or equal to 1" actually means for this field).
 * @param rawMessage the resolver's raw validator message, or `undefined` (no error).
 * @returns human-readable copy, or `rawMessage` unchanged if no mapping matches.
 */
export function humanizeFieldError(field: string, rawMessage: string | undefined): string | undefined {
  if (!rawMessage) return rawMessage;
  const patterns = FIELD_MESSAGE_PATTERNS[field];
  if (!patterns) return rawMessage;
  for (const [pattern, human] of patterns) {
    if (pattern.test(rawMessage)) return human;
  }
  return rawMessage;
}
