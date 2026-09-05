import { Type, type Schema } from '@google/genai';

/**
 * Converts a Google Gemini-style `Schema` (OpenAPI-subset, uppercase `Type` enum — the shape
 * `@google/adk`'s `LlmAgent` always normalizes its `outputSchema` config down to before it ever
 * reaches a `BaseLlm`, per `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #6) into a
 * standard JSON Schema (lowercase `type`) suitable for OpenRouter's OpenAI-compatible
 * `response_format: {type: 'json_schema', json_schema: {schema: ...}}`.
 *
 * Pure, framework-free — no I/O, recurses through `properties`/`items`/`anyOf`. Not a complete
 * OpenAPI↔JSON-Schema converter (only the subset this app's own hand-written per-operation schemas
 * ever use), but every field it does convert is a faithful, lossless mapping.
 */
export function schemaToJsonSchema(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (schema.type !== undefined) {
    out.type = mapType(schema.type);
  }
  if (schema.description !== undefined) out.description = schema.description;
  if (schema.enum !== undefined) out.enum = schema.enum;
  if (schema.format !== undefined) out.format = schema.format;
  if (schema.nullable !== undefined) out.nullable = schema.nullable;
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.minLength !== undefined) out.minLength = Number(schema.minLength);
  if (schema.maxLength !== undefined) out.maxLength = Number(schema.maxLength);
  if (schema.minItems !== undefined) out.minItems = Number(schema.minItems);
  if (schema.maxItems !== undefined) out.maxItems = Number(schema.maxItems);

  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, schemaToJsonSchema(value)]));
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = schemaToJsonSchema(schema.items);
  if (schema.anyOf) out.anyOf = schema.anyOf.map((s) => schemaToJsonSchema(s));

  return out;
}

/** Maps a single Gemini `Type` enum value to its lowercase JSON Schema equivalent. `TYPE_UNSPECIFIED`
 * has no meaningful JSON Schema mapping — omitted (`type` left unset) rather than guessed. */
function mapType(type: Type): string | undefined {
  switch (type) {
    case Type.STRING:
      return 'string';
    case Type.NUMBER:
      return 'number';
    case Type.INTEGER:
      return 'integer';
    case Type.BOOLEAN:
      return 'boolean';
    case Type.ARRAY:
      return 'array';
    case Type.OBJECT:
      return 'object';
    case Type.NULL:
      return 'null';
    default:
      return undefined;
  }
}
