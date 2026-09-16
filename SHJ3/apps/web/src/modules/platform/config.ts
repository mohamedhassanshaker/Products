/**
 * Boot-time configuration validation.
 *
 * Two jobs, and the second is the one this module exists for.
 *
 * ## 1. A missing secret stops the process
 *
 * `SHJ3_SQL_URL` and `SHJ3_REDIS_URL` are already checked at first use by their
 * adapters, and both of those checks say the same thing: "the process should have
 * refused to start". This is that refusal. Failing at boot turns a missing
 * environment variable into a deployment that never accepts traffic, rather than
 * a deployment that serves half the requests and 500s the rest — which is the
 * failure mode that gets diagnosed as "the database is flaky".
 *
 * ## 2. The mock verification adapter cannot boot in production
 *
 * ADR-0006 rule 6, and the reason it is enforced here rather than by review:
 * `MockVerificationProvider` will return `L2` for any citizen who asks, because
 * that is what makes B11's step-up rules testable before UAE PASS exists
 * (rule 5). In front of the payment endpoints, that adapter is an unauthenticated
 * "pay from anyone's account" button. It is the worst failure this system could
 * have, and the *shape* of the mistake — a staging value left in a production
 * environment file — is one of the most common in software. So the process
 * refuses to start, and there is no flag to override it.
 *
 * Note that this check reads only configuration, never a database or a feature
 * flag: a runtime toggle that disables the mock could be toggled back, and one
 * that lives in a tenant's own settings could be changed by a tenant.
 *
 * ## Why hand-rolled rather than a schema library
 *
 * `zod` is a dependency of this workspace and would express the shape in fewer
 * lines. It is not used here for two reasons. The error message is the entire
 * product of this module — an operator at 2am needs "SHJ3_SESSION_SECRET is
 * missing" and the ADR reference, not a formatted issue tree — and a validator
 * whose job is to run before anything else is a poor place to depend on anything
 * else. This module imports nothing.
 *
 * ## Exhaustive, not fail-fast
 *
 * Every problem is collected and reported together (mirroring api.md §12
 * invariant 8's stance on request validation). An operator fixing one variable
 * per restart cycle learns nothing about how far from a working deployment they
 * are.
 */

/** Values `SHJ3_ENVIRONMENT` may take. Ordered from most permissive to least. */
export const ENVIRONMENTS = ["development", "test", "staging", "production"] as const;

export type Shj3Environment = (typeof ENVIRONMENTS)[number];

/**
 * Selectable `VerificationProvider` adapters (ADR-0006).
 *
 * `uaepass` and `otp` do not exist yet — UAE PASS onboarding is a procurement
 * dependency with a long lead time (RISK-004). They are named here anyway so that
 * the production environment has a legal value to be configured *with*, rather
 * than the mock being the only thing the validator recognises.
 */
export const VERIFICATION_ADAPTERS = ["mock", "uaepass", "otp"] as const;

export type VerificationAdapter = (typeof VERIFICATION_ADAPTERS)[number];

/**
 * Selectable `PaymentGateway` adapters (B-8, mirroring ADR-0006's own
 * `VerificationAdapter` shape). `sharjahpay` / `sewadirectdebit` do not exist
 * yet — no real payment processor is integrated anywhere in this codebase.
 * Named here anyway so a production environment has a legal, non-`mock` value
 * to be configured with, matching `VERIFICATION_ADAPTERS`'s identical reasoning.
 */
export const PAYMENT_GATEWAY_ADAPTERS = ["mock", "sharjahpay", "sewadirectdebit"] as const;

export type PaymentGatewayAdapter = (typeof PAYMENT_GATEWAY_ADAPTERS)[number];

export interface Shj3Config {
  readonly environment: Shj3Environment;
  readonly sqlUrl: string;
  readonly redisUrl: string;
  /** Signs the session cookie's integrity tag. The session id itself is opaque and random. */
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly verificationAdapter: VerificationAdapter;
  readonly paymentGatewayAdapter: PaymentGatewayAdapter;
  /**
   * Base64, decodes to exactly 32 bytes — the AES-256-GCM key envelope-encrypting secrets
   * at rest (deployment.md §16 var #12): staff TOTP secrets
   * (`StaffCredentials.totpSecretCipher`, added B-2) and, later, tenant-held connector
   * credentials. Kept as the raw base64 string here, like `sessionSecret` — the adapter that
   * actually encrypts (`modules/platform/adapters/outbound/crypto/envelope-encryption.ts`)
   * decodes it, so this module stays free of a crypto import for the one thing it does not
   * need one for: reporting *why* a value is unusable, not using it.
   */
  readonly encryptionKey: string;
}

/**
 * The dev placeholder from `.env.example`.
 *
 * Checked by value because the realistic accident is not an attacker choosing a
 * weak secret — it is `.env.example` being copied to `.env.production` and the
 * one line nobody edited being the one that matters.
 */
const DEV_SESSION_SECRET_PLACEHOLDER = "local-dev-session-secret-not-for-production";

/**
 * 32 characters. Not a cryptographic threshold — the underlying HMAC accepts any
 * length — but a floor that a hand-typed value fails and a generated one passes.
 */
const MIN_SESSION_SECRET_LENGTH = 32;

const DEFAULT_SESSION_TTL_SECONDS = 28_800;

/**
 * The dev placeholder from `.env.example` — a real, validly-shaped 32-byte key (unlike
 * `SHJ3_SESSION_SECRET`'s placeholder, which is deliberately *not* real, because an HMAC
 * key has no fixed-length requirement to fail — AES-256-GCM's key length is a hard
 * structural requirement of the algorithm, not a "stronger in production" concern, so even
 * local development needs a genuinely 32-byte value or every encrypt/decrypt call throws).
 * Checked by value for the same reason `SHJ3_SESSION_SECRET`'s is: the realistic accident
 * is `.env.example` copied into a deployed environment's file, not an attacker guessing it.
 */
const DEV_ENCRYPTION_KEY_PLACEHOLDER = "+yddTmNwlSyCtqzv2bABbnYmDiwu9hojxvkrJ73e4U8=";

/** AES-256 requires exactly this many key bytes — not a policy choice. */
const ENCRYPTION_KEY_BYTES = 32;

/**
 * Raised when the environment cannot support a running process.
 *
 * Carries every problem, and deliberately no *values* — only variable names. This
 * error reaches logs, and a validation failure that prints the secret it is
 * complaining about has leaked it to everywhere logs go.
 */
export class ConfigurationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `SHJ3 refused to start: ${problems.length} configuration problem(s).\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
    this.name = "ConfigurationError";
  }
}

type RawEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Validate an environment and produce the config, or throw.
 *
 * Takes the environment as an argument rather than reading `process.env`, so the
 * production-mock refusal is a unit test rather than something only a deployment
 * can demonstrate. That test is the point: a guard nobody can exercise is a guard
 * nobody knows still works.
 */
export function validateConfig(env: RawEnvironment): Shj3Config {
  const problems: string[] = [];

  const environment = readEnvironment(env.SHJ3_ENVIRONMENT, problems);
  const verificationAdapter = readVerificationAdapter(env.SHJ3_VERIFICATION_ADAPTER, problems);
  const paymentGatewayAdapter = readPaymentGatewayAdapter(
    env.SHJ3_PAYMENT_GATEWAY_ADAPTER,
    problems,
  );

  const sqlUrl = required(env, "SHJ3_SQL_URL", problems);
  const redisUrl = required(env, "SHJ3_REDIS_URL", problems);
  const sessionSecret = required(env, "SHJ3_SESSION_SECRET", problems);
  const sessionTtlSeconds = readSessionTtl(env.SHJ3_SESSION_TTL_SECONDS, problems);
  const encryptionKey = readEncryptionKey(env, problems);

  // Deployed environments — anything but a developer's machine or the test suite.
  const deployed = environment === "staging" || environment === "production";

  if (deployed && sessionSecret === DEV_SESSION_SECRET_PLACEHOLDER) {
    problems.push(
      `SHJ3_SESSION_SECRET is still the placeholder from .env.example, and SHJ3_ENVIRONMENT is "${environment}". ` +
        "Generate one with `openssl rand -base64 48`.",
    );
  }

  if (deployed && sessionSecret.length > 0 && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      `SHJ3_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters in a deployed environment.`,
    );
  }

  if (deployed && encryptionKey === DEV_ENCRYPTION_KEY_PLACEHOLDER) {
    problems.push(
      `SHJ3_ENCRYPTION_KEY is still the placeholder from .env.example, and SHJ3_ENVIRONMENT is "${environment}". ` +
        "Generate one with `openssl rand -base64 32`. Rotating it later re-encrypts every row it protects " +
        "(deployment.md §16.6), so get this one right before the first secret is ever encrypted with it.",
    );
  }

  // ADR-0006 rule 6. The one check in this file that is not about a missing
  // value, and the one it was written for.
  if (verificationAdapter === "mock" && environment === "production") {
    problems.push(
      "SHJ3_VERIFICATION_ADAPTER=mock cannot run with SHJ3_ENVIRONMENT=production. " +
        "MockVerificationProvider grants any assurance level on request, which in front of the " +
        "payment endpoints is an unauthenticated payment path (ADR-0006 rule 6). " +
        "Configure a real adapter, or do not run this build in production.",
    );
  }

  // B-8's own payments analogue of ADR-0006 rule 6: `MockPaymentGateway`
  // settles every intent deterministically with no real money movement,
  // which in front of the real payment endpoints is an unauthenticated
  // charge path — exactly as dangerous as the mocked verification path this
  // file already refuses above.
  if (paymentGatewayAdapter === "mock" && environment === "production") {
    problems.push(
      "SHJ3_PAYMENT_GATEWAY_ADAPTER=mock cannot run with SHJ3_ENVIRONMENT=production. " +
        "MockPaymentGateway settles any payment intent with no real gateway call, which is " +
        "an unauthenticated charge path in production. Configure a real adapter, or do not " +
        "run this build in production.",
    );
  }

  if (problems.length > 0) throw new ConfigurationError(problems);

  return {
    environment,
    sqlUrl,
    redisUrl,
    sessionSecret,
    sessionTtlSeconds,
    verificationAdapter,
    paymentGatewayAdapter,
    encryptionKey,
  };
}

/**
 * Base64-decodable to exactly 32 bytes — checked unconditionally, in every environment,
 * unlike `SHJ3_SESSION_SECRET`'s length floor (which only bites in a deployed environment).
 * There is no "good enough for development" AES-256 key length: a value that decodes to
 * the wrong byte count makes every `createCipheriv("aes-256-gcm", ...)` call throw, in any
 * environment, so the honest place to catch it is boot, not the first TOTP enrolment.
 */
function readEncryptionKey(env: RawEnvironment, problems: string[]): string {
  const value = required(env, "SHJ3_ENCRYPTION_KEY", problems);
  if (!value) return "";

  const decoded = Buffer.from(value, "base64");
  // Buffer.from(..., "base64") does not throw on malformed input — it silently stops
  // decoding at the first invalid character — so a wrong byte count is the only signal
  // available for "this is not really base64" as well as "this is base64 but the wrong key size".
  if (decoded.length !== ENCRYPTION_KEY_BYTES) {
    problems.push(
      `SHJ3_ENCRYPTION_KEY must be base64 that decodes to exactly ${ENCRYPTION_KEY_BYTES} bytes ` +
        `(AES-256's key length) — got ${decoded.length} byte(s). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return value;
}

function required(env: RawEnvironment, name: string, problems: string[]): string {
  const value = env[name]?.trim();
  if (!value) {
    problems.push(`${name} is not set.`);
    return "";
  }
  return value;
}

/**
 * An unset environment is a problem, not a default of `development`.
 *
 * Defaulting would mean a production deployment that forgot the variable
 * silently becomes the most permissive setting — including the one where the mock
 * verification adapter is allowed.
 */
function readEnvironment(value: string | undefined, problems: string[]): Shj3Environment {
  const candidate = value?.trim();
  if (!candidate) {
    problems.push(`SHJ3_ENVIRONMENT is not set. Expected one of ${ENVIRONMENTS.join(", ")}.`);
    return "production";
  }
  if (!(ENVIRONMENTS as readonly string[]).includes(candidate)) {
    problems.push(
      `SHJ3_ENVIRONMENT is not a recognised environment. Expected one of ${ENVIRONMENTS.join(", ")}.`,
    );
    return "production";
  }
  return candidate as Shj3Environment;
}

/**
 * Both the unset and the unrecognised case resolve to `mock` *for the purpose of
 * further checks*, which is deliberate: combined with the production refusal
 * above, a production deployment that misspells the adapter name fails to boot
 * rather than falling back to something plausible.
 */
function readVerificationAdapter(
  value: string | undefined,
  problems: string[],
): VerificationAdapter {
  const candidate = value?.trim();
  if (!candidate) {
    problems.push(
      `SHJ3_VERIFICATION_ADAPTER is not set. Expected one of ${VERIFICATION_ADAPTERS.join(", ")}.`,
    );
    return "mock";
  }
  if (!(VERIFICATION_ADAPTERS as readonly string[]).includes(candidate)) {
    problems.push(
      `SHJ3_VERIFICATION_ADAPTER is not a recognised adapter. Expected one of ${VERIFICATION_ADAPTERS.join(", ")}.`,
    );
    return "mock";
  }
  return candidate as VerificationAdapter;
}

/**
 * Both the unset and the unrecognised case resolve to `mock` *for the purpose
 * of further checks* — identical reasoning to `readVerificationAdapter`: a
 * production deployment that misspells the adapter name fails to boot rather
 * than falling back to something plausible.
 */
function readPaymentGatewayAdapter(
  value: string | undefined,
  problems: string[],
): PaymentGatewayAdapter {
  const candidate = value?.trim();
  if (!candidate) {
    problems.push(
      `SHJ3_PAYMENT_GATEWAY_ADAPTER is not set. Expected one of ${PAYMENT_GATEWAY_ADAPTERS.join(", ")}.`,
    );
    return "mock";
  }
  if (!(PAYMENT_GATEWAY_ADAPTERS as readonly string[]).includes(candidate)) {
    problems.push(
      `SHJ3_PAYMENT_GATEWAY_ADAPTER is not a recognised adapter. Expected one of ${PAYMENT_GATEWAY_ADAPTERS.join(", ")}.`,
    );
    return "mock";
  }
  return candidate as PaymentGatewayAdapter;
}

function readSessionTtl(value: string | undefined, problems: string[]): number {
  const candidate = value?.trim();
  if (!candidate) return DEFAULT_SESSION_TTL_SECONDS;

  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    problems.push("SHJ3_SESSION_TTL_SECONDS must be a positive integer number of seconds.");
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return parsed;
}

let cached: Shj3Config | null = null;

/**
 * The validated configuration for this process.
 *
 * Memoised, because configuration cannot change without a restart and a value
 * that could change per read would be a value the mock refusal could be talked
 * out of. Call this once at startup, before anything opens a connection.
 */
export function loadConfig(): Shj3Config {
  cached ??= validateConfig(process.env);
  return cached;
}

/** Drop the memoised config. Tests only — production configuration is immutable. */
export function resetConfigForTesting(): void {
  cached = null;
}
