import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * Ajv exists **exclusively in this package** (LLD §1.1 / §5.4): MCP tool
 * input/output schemas are arbitrary third-party JSON Schema supplied at runtime, not
 * a first-party TypeBox-authored contract, so `Value.Check` cannot validate them.
 * `dependency-cruiser`'s `no-ajv-outside-mcp-client` rule enforces this boundary.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

/** Compiles and validates `data` against an arbitrary JSON Schema document. Each call
 * compiles fresh (no persistent cache) — discovery/call-tool volumes in this phase
 * don't justify a compiled-schema cache yet; revisit if profiling says otherwise. */
export function validateAgainstJsonSchema(schema: object, data: unknown): ValidationOutcome {
  try {
    const validateFn = ajv.compile(schema);
    const valid = validateFn(data) as boolean;
    return {
      valid,
      errors: valid ? [] : (validateFn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`),
    };
  } catch (err) {
    return { valid: false, errors: [`Schema compilation failed: ${(err as Error).message}`] };
  }
}
