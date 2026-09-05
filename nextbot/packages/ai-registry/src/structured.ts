import { type TSchema, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { StructuredOutputInvalidError } from "@nextbot/contracts";
import { generateTextOverChain, resolveModel, type ResolvedChainEntry } from "./registry.js";
import type { ChatMessage } from "./providers/types.js";
import type { LogicalModelName } from "./config.js";

/**
 * LLD §7.2 — the **only** sanctioned way anything in this codebase turns a model
 * completion into application data. Passes the TypeBox schema to the provider's
 * native structured-output facility (`ProviderCallParams.jsonSchema`) *and*
 * re-validates the return with `Value.Check`/`Value.Decode`, because a model can
 * still return schema-violating output even when asked nicely. `JSON.parse()` over a
 * free-text completion, regex-extracting JSON from markdown fences, or "best effort"
 * field-picking are all prohibited anywhere in this codebase (`nexus-qa` greps for
 * them) — this function is the sole substitute.
 *
 * @param args.chain a pre-resolved provider fallback chain (see `registry.ts`'s doc —
 * chain resolution/region-filtering/budget/cache is `agent-platform`'s job); when
 * omitted, falls back to `resolveModel(args.routeKey as LogicalModelName)`'s
 * single-entry env-default chain, so a caller with no `agent-platform` wiring yet
 * (e.g. a unit test, or a feature not yet migrated onto the Model Gateway) still works.
 * @throws {StructuredOutputInvalidError} if the response still fails `Value.Check`
 * after one repair attempt (the validation errors are fed back to the model once,
 * per LLD §7.2's `maxRepairAttempts` default of 1) — never returns a partial/coerced
 * object.
 */
export async function generateStructured<S extends TSchema>(args: {
  routeKey: string;
  schema: S;
  system: string;
  messages: ChatMessage[];
  chain?: ResolvedChainEntry[];
  totalTimeoutMs?: number;
  maxRepairAttempts?: number;
}): Promise<Static<S>> {
  const chain = args.chain ?? [resolveModel(args.routeKey as LogicalModelName)];
  const jsonSchema = typeboxToJsonSchema(args.schema);
  const maxRepairAttempts = args.maxRepairAttempts ?? 1;

  let messages = args.messages;
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    const result = await generateTextOverChain(chain, args.routeKey, { system: args.system, messages, jsonSchema }, args.totalTimeoutMs);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && Value.Check(args.schema, parsed)) {
      return Value.Decode(args.schema, parsed);
    }
    if (attempt < maxRepairAttempts) {
      const errors = parsed === undefined ? [{ path: "", message: "response was not valid JSON" }] : [...Value.Errors(args.schema, parsed)].map((e) => ({ path: e.path, message: e.message }));
      messages = [
        ...messages,
        { role: "assistant", content: result.text },
        {
          role: "user",
          content: `Your previous response did not conform to the required schema. Errors: ${JSON.stringify(errors)}. Reply again with ONLY valid JSON conforming to the schema.`,
        },
      ];
    }
  }
  throw new StructuredOutputInvalidError(args.routeKey);
}

/** Plain-text completion path (LLD §7.1's `generateText`) — no schema, no re-parsing;
 * used for prose the caller renders as-is (e.g. an AI-drafted escalation summary
 * before a human edits it, FR-AI-08), never for anything that feeds application logic. */
export async function generateText(args: {
  routeKey: string;
  system?: string;
  messages: ChatMessage[];
  chain?: ResolvedChainEntry[];
  totalTimeoutMs?: number;
}): Promise<string> {
  const chain = args.chain ?? [resolveModel(args.routeKey as LogicalModelName)];
  const result = await generateTextOverChain(chain, args.routeKey, { system: args.system, messages: args.messages }, args.totalTimeoutMs);
  return result.text;
}

/**
 * Minimal TypeBox -> JSON Schema projection for the request-side hint sent to a
 * provider's structured-output facility. TypeBox schemas already compile to
 * JSON-Schema-shaped objects (`Type.Object` etc. produce plain JSON Schema under the
 * hood) — this only strips the handful of TypeBox-internal `Symbol`-keyed
 * properties/`$id` a provider would otherwise choke on, keeping the result inside the
 * OpenAPI-3.0 subset providers accept (LLD §7.2).
 */
function typeboxToJsonSchema(schema: TSchema): Record<string, unknown> {
  const rest = { ...(schema as unknown as Record<string, unknown>) };
  delete rest.$id;
  return JSON.parse(JSON.stringify(rest));
}
