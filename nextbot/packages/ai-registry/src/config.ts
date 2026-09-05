import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Environment configuration for `@nextbot/ai-registry` (LLD §7.1, ADR-0006, Nexus
 * architecture guide §2). Validated with TypeBox **once, lazily, on first use** —
 * a missing/invalid value is a startup failure, never a runtime surprise (LLD
 * §11.10) — but lazily so that packages/apps which never call into this registry
 * (most of the test suite) don't need every `AI_*` var set just to import it.
 *
 * `AI_BASE_URL` is what makes on-prem/self-hosted models first-class (ADR-0006 §2.2):
 * pointing it at an Ollama/vLLM/LM Studio/internal-gateway OpenAI-compatible endpoint
 * requires no code path of its own, only this one env var.
 */
const EnvSchema = Type.Object({
  AI_PROVIDER: Type.Union([
    Type.Literal("openai"),
    Type.Literal("anthropic"),
    Type.Literal("gemini"),
    Type.Literal("openai-compatible"),
  ]),
  AI_BASE_URL: Type.Optional(Type.String({ minLength: 1 })),
  AI_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  AI_MODEL_CHAT_PRIMARY: Type.String({ minLength: 1 }),
  AI_MODEL_CHAT_FAST: Type.Optional(Type.String({ minLength: 1 })),
  AI_MODEL_REASONING_PLANNER: Type.Optional(Type.String({ minLength: 1 })),
  AI_MODEL_CLASSIFY_GUARDRAIL: Type.Optional(Type.String({ minLength: 1 })),
  AI_MODEL_SUMMARIZE: Type.Optional(Type.String({ minLength: 1 })),
  AI_MODEL_EMBED: Type.Optional(Type.String({ minLength: 1 })),
  AI_REQUEST_TIMEOUT_MS: Type.Optional(Type.String({ minLength: 1 })),
  AI_TOTAL_TIMEOUT_MS: Type.Optional(Type.String({ minLength: 1 })),
});

export type AiRegistryEnv = Static<typeof EnvSchema>;

/** The fixed set of logical model names feature code may ask for (LLD §7.1 table). A
 * vendor model id must never appear outside this module's env parsing. */
export const LOGICAL_MODEL_NAMES = [
  "chat.primary",
  "chat.fast",
  "reasoning.planner",
  "classify.guardrail",
  "summarize.escalation",
  "embed.knowledge",
] as const;
export type LogicalModelName = (typeof LOGICAL_MODEL_NAMES)[number];

const LOGICAL_NAME_TO_ENV_VAR: Record<LogicalModelName, keyof AiRegistryEnv> = {
  "chat.primary": "AI_MODEL_CHAT_PRIMARY",
  "chat.fast": "AI_MODEL_CHAT_FAST",
  "reasoning.planner": "AI_MODEL_REASONING_PLANNER",
  "classify.guardrail": "AI_MODEL_CLASSIFY_GUARDRAIL",
  "summarize.escalation": "AI_MODEL_SUMMARIZE",
  "embed.knowledge": "AI_MODEL_EMBED",
};

let cached: AiRegistryEnv | undefined;

/** @throws synchronously if `AI_PROVIDER`/`AI_MODEL_CHAT_PRIMARY` (the only two
 * genuinely required vars — every other logical name falls back to `chat.primary`'s
 * model if unset, since not every deployment needs a distinct model per logical name)
 * are missing or malformed. */
export function loadAiRegistryEnv(): AiRegistryEnv {
  if (cached) return cached;
  // QA Final Review B2: an *unset* optional env var and one set to the empty
  // string must be treated identically ("genuinely not configured") — otherwise
  // deployment tooling that defaults an unconfigured optional var to `""` (e.g.
  // docker-compose's `${VAR:-}` interpolation) trips `minLength: 1` and fails
  // startup validation for every optional field, even though the *intended*
  // semantics of "unset" and "empty string" are the same here. Required fields
  // (`AI_PROVIDER`, `AI_MODEL_CHAT_PRIMARY`) are deliberately left as-is: an empty
  // string for a required field should still fail loudly, not silently coerce to
  // "missing" and produce a less useful error message.
  const normalizeOptional = (value: string | undefined): string | undefined => (value === "" ? undefined : value);
  const raw = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: normalizeOptional(process.env.AI_BASE_URL),
    AI_API_KEY: normalizeOptional(process.env.AI_API_KEY),
    AI_MODEL_CHAT_PRIMARY: process.env.AI_MODEL_CHAT_PRIMARY,
    AI_MODEL_CHAT_FAST: normalizeOptional(process.env.AI_MODEL_CHAT_FAST),
    AI_MODEL_REASONING_PLANNER: normalizeOptional(process.env.AI_MODEL_REASONING_PLANNER),
    AI_MODEL_CLASSIFY_GUARDRAIL: normalizeOptional(process.env.AI_MODEL_CLASSIFY_GUARDRAIL),
    AI_MODEL_SUMMARIZE: normalizeOptional(process.env.AI_MODEL_SUMMARIZE),
    AI_MODEL_EMBED: normalizeOptional(process.env.AI_MODEL_EMBED),
    AI_REQUEST_TIMEOUT_MS: normalizeOptional(process.env.AI_REQUEST_TIMEOUT_MS),
    AI_TOTAL_TIMEOUT_MS: normalizeOptional(process.env.AI_TOTAL_TIMEOUT_MS),
  };
  if (!Value.Check(EnvSchema, raw)) {
    const errors = [...Value.Errors(EnvSchema, raw)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(`Invalid @nextbot/ai-registry environment configuration: ${errors.join("; ")}`);
  }
  cached = raw;
  return raw;
}

/** Test-only: clears the cached env so a test can reconfigure `process.env` and
 * re-parse. Not exported from the package's public entry point. */
export function resetAiRegistryEnvCacheForTests(): void {
  cached = undefined;
}

/** Resolves the vendor model id for a logical name from env config — the "env
 * default" (outermost) tier of LLD §7.1's three-tier resolution
 * (tenant model_route -> platform model_route -> env default). Falls back to
 * `chat.primary`'s configured model when a more specific logical name has no
 * dedicated env var set, so a minimal deployment only needs one model configured. */
export function resolveEnvModelId(logicalName: LogicalModelName): string {
  const env = loadAiRegistryEnv();
  const specific = env[LOGICAL_NAME_TO_ENV_VAR[logicalName]];
  return specific ?? env.AI_MODEL_CHAT_PRIMARY;
}

/**
 * Deliberately reads `process.env` directly rather than going through
 * `loadAiRegistryEnv()` — the per-attempt/whole-chain timeouts are meaningful (and
 * must resolve to a sane default) even for a caller that supplies its own fully-
 * resolved `chain` and therefore never needs `AI_PROVIDER`/`AI_MODEL_CHAT_PRIMARY` to
 * be configured at all (e.g. `packages/modules/agent-platform`'s Model Gateway, which
 * always passes an explicit chain resolved from `model_route`). Requiring the full
 * env schema here would make an unrelated, chain-scoped timeout default fail startup
 * validation for a caller that never touches the env-driven resolution path.
 */
export function requestTimeoutMs(): number {
  return Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 20000);
}

export function totalTimeoutMs(): number {
  return Number(process.env.AI_TOTAL_TIMEOUT_MS ?? 30000);
}
