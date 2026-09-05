/**
 * UTF-8 byte length of a string (spec FR-CONFIG-2: `agent.system_prompt`'s
 * limit is 32,768 **bytes**, not characters — a naive `.length` undercounts
 * any multi-byte character, UX_GUIDELINES §10.6). Moved here in Phase 16
 * (BL-063, "Reasoning tab: add the 'Core instructions' section") from
 * `features/agent-builder/services/`: the system prompt textarea moved from
 * the old Agent Builder page to the Reasoning tab, and this pure formatting
 * helper has no feature-specific dependency, so it belongs in the shared lib
 * both features may import rather than staying feature-local (which would
 * otherwise mean either duplicating it or an ESLint feature-isolation
 * violation, `eslint.config.mjs` `webFeatures`).
 * @param value - Candidate text
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
