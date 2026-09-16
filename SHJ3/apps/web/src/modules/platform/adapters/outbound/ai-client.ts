/**
 * Typed client for the `shj3-ai` internal API.
 *
 * ## Why the web tier calls a service instead of a store
 *
 * ADR-0003's ownership table gives Neo4j and Qdrant to `shj3-ai`: it is their sole
 * writer, which is what makes reconciliation of two derived indexes tractable at all. The
 * web tier never opens a graph or vector connection — *"if a backoffice screen needs graph
 * data … it calls the AI service's HTTP API."* deployment.md §7.7 enforces the same rule
 * as a NetworkPolicy: only `shj3-ai` and `shj3-worker` may reach those two stores, so a
 * driver in this process would not merely be wrong, it would not connect.
 *
 * This module is therefore the whole of the web tier's access to those stores.
 *
 * ## Trace propagation
 *
 * One trace id spans web → ai → tool call (architecture.md §10, deployment.md §13.1,
 * ADR-0001 follow-up). The trace id is read from the bound tenant context rather than
 * generated here, so a provisioning run and the graph and vector work it triggers appear as
 * one trace in B14 tab 3 instead of three unrelated ones — that is the difference between
 * observability and decoration. It travels to `shj3-ai` two ways, deliberately: as a
 * `traceparent` header (`observability/trace-context.ts`'s `injectTraceparent`, W3C-shaped,
 * what OpenTelemetry's own extractor on the far side reads) and as `X-Request-Id` (the raw,
 * possibly-non-hex value this system uses internally, for a human or a log query to match
 * verbatim without decoding a `traceparent`). Two headers, one id, two audiences — not two
 * competing trace mechanisms.
 *
 * ## Errors
 *
 * api.md §2.2: an error body may never carry vendor text, vendor status codes, upstream
 * URLs, internal hostnames or SQL/Cypher fragments. This client is a *consumer* of the
 * internal API, so it is where that rule is at risk of being broken by accident — the
 * easy implementation attaches the response body to an `Error` and lets it propagate to a
 * problem document. Instead only the stable `code` is taken from the response, and only
 * after it is validated against the shape api.md §2.1 defines for one. Everything else the
 * far side said is logged against the trace id and dropped.
 *
 * ## Two calling contexts, one transport
 *
 * `createAiClient()`/`getAiClient()` carry the **platform-scoped** credential (api.md §5's
 * header table names it as the exception for the two audited cross-tenant paths, ADR-0002
 * rule 5) — provisioning acts *on* a tenant with no principal to resolve headers from.
 * Everything else that calls `shj3-ai` is a **tenant-scoped** staff or citizen request with
 * a real bound principal, which api.md §5's header table documents separately
 * (`X-SHJ3-Tenant-Id`/`X-SHJ3-Principal-Id`/`X-SHJ3-Permissions`, no platform token at all)
 * — `createTenantScopedAiClient()`/`getTenantScopedAiClient()` below are that second
 * context (first real caller: `modules/tools`' MCP "connect & discover" proxy). Both share
 * the identical transport/timeout/error-translation logic (`performPost`) so the two never
 * silently diverge on the one thing that actually matters for safety — never leaking a
 * vendor error across the hop — while injecting materially different headers for the
 * different question each credential answers ("which service" vs. "acting as whom, in
 * which tenant, with which permissions").
 */

import { requireTenantContext, requirePrincipal } from "../../tenancy/tenant-context.js";
import { injectTraceparent } from "../../observability/trace-context.js";

/** The internal API's prefix (api.md §5). */
const API_PREFIX = "/v1";

/**
 * deployment.md §4.2 #18's documented default for this hop. Shared with the turn request
 * deliberately: one client, one timeout, one number an operator has to reason about — and
 * the slowest calls on either path (a long tool chain, or graph index creation) are of the
 * same order.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * SHJ3 error codes are `<domain>.<reason>`, lowercase snake_case after the dot, and are
 * part of the published contract. Anything not matching that shape did not come from our
 * error serialiser, so it is not ours to forward.
 */
const SHJ3_ERROR_CODE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Fallbacks when the far side did not supply a usable code (api.md §2.3). */
const STATUS_FALLBACK_CODES: Record<number, string> = {
  401: "upstream.unavailable",
  403: "upstream.unavailable",
  404: "upstream.invalid_response",
  409: "upstream.invalid_response",
  422: "upstream.invalid_response",
  429: "rate_limit.exceeded",
  500: "upstream.unavailable",
  502: "upstream.invalid_response",
  503: "upstream.unavailable",
  504: "upstream.timeout",
};

/**
 * A failure of the web → ai hop, carrying a code and nothing else that could leak.
 *
 * The message is written for an operator reading logs and is safe to surface as a problem
 * document's `detail`: it names the code and the trace id, never the far side's words.
 */
/**
 * The closed set `docs/api.md` §5.6 documents for `tools.mcp_connect_failed`'s
 * `meta.reason` — validated here, not trusted from the far side verbatim.
 */
const MCP_CONNECT_FAILURE_REASONS = ["dns", "tls", "auth", "timeout", "protocol"] as const;
type McpConnectFailureReason = (typeof MCP_CONNECT_FAILURE_REASONS)[number];

export class AiServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly traceId: string,
    readonly path: string,
    /**
     * Set only when `code === "tools.mcp_connect_failed"` and the far side's own
     * `meta.reason` matched api.md §5.6's closed set exactly. This is **not** a general
     * exemption from the anti-leak rule below — `meta.reason` is one of the handful of
     * stable, published-contract tokens (like `code` itself), never the far side's own
     * words, so carrying it here is the same trust decision this class already makes for
     * `code`, applied to the one other field api.md documents as stable for this one
     * error code.
     */
    readonly mcpConnectFailureReason?: McpConnectFailureReason,
  ) {
    super(
      `The AI service failed "${path}" with ${code}. ` +
        `Find the upstream detail by trace id ${traceId}; it is logged there and deliberately ` +
        "not carried on this error (api.md §2.2).",
    );
    this.name = "AiServiceError";
  }
}

export interface AiClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injected in tests. Node 22's global `fetch` otherwise. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The internal API surface this client exposes.
 *
 * A single `post` rather than a method per endpoint: every internal provisioning call has
 * the same shape, and the endpoint-specific typing belongs with the adapter that knows
 * what it is asking for.
 */
export interface AiClient {
  post<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse>;
}

function baseUrl(configured: string | undefined): string {
  const url = configured ?? process.env.SHJ3_AI_BASE_URL;
  if (!url) {
    throw new Error(
      "SHJ3_AI_BASE_URL is not set. The process should have refused to start — check the " +
        "boot-time config validation.",
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * The platform-scope credential for the internal API.
 *
 * mTLS proves *which service* is calling (api.md §5), and the NetworkPolicy makes it the
 * only one that can. Neither proves the call is a sanctioned platform operation rather
 * than a tenant-scoped request that wandered — so provisioning carries its own
 * credential, and the far side requires it. Two controls, two different questions.
 */
function platformToken(): string {
  const token = process.env.SHJ3_AI_PLATFORM_TOKEN;
  if (!token) {
    throw new Error(
      "SHJ3_AI_PLATFORM_TOKEN is not set, so no platform-scoped call to shj3-ai can be " +
        "authenticated. Provisioning is one of only two sanctioned cross-tenant paths " +
        "(ADR-0002 rule 5) and is not permitted to run unauthenticated.",
    );
  }
  return token;
}

/**
 * Resolve the per-call timeout.
 *
 * A mistyped env var must not reach `AbortSignal.timeout`, which throws a `RangeError` on a
 * non-finite value — that would surface as an opaque crash mid-provisioning rather than as
 * the misconfiguration it is.
 */
function resolveTimeout(configured: number | undefined): number {
  const candidate = configured ?? Number(process.env.SHJ3_AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    console.warn("[ai-client] ignoring an unusable timeout; falling back to the default", {
      configured: process.env.SHJ3_AI_TIMEOUT_MS,
    });
    return DEFAULT_TIMEOUT_MS;
  }
  return candidate;
}

/**
 * The shared transport: build the URL, attach the caller's already-built headers plus the
 * trace pair every call carries regardless of scope, fetch with a timeout, and translate
 * any failure into an `AiServiceError` that cannot leak vendor detail. Both `createAiClient`
 * and `createTenantScopedAiClient` are thin header-builders around this one function, so
 * the transport/error-translation behaviour cannot silently diverge between the two
 * calling contexts.
 */
async function performPost<TResponse>(input: {
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly baseHeaders: Record<string, string>;
  readonly baseUrlOverride: string | undefined;
  readonly timeoutMs: number;
  readonly doFetch: typeof globalThis.fetch;
}): Promise<TResponse> {
  const { traceId } = requireTenantContext(`ai service call ${input.path}`);

  // Resolved before the try, deliberately. A missing base URL or credential is a
  // configuration error, and letting it be caught below would report it as an upstream
  // failure — sending an operator to look for a service that is not down.
  const url = `${baseUrl(input.baseUrlOverride)}${API_PREFIX}${input.path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "X-Request-Id": traceId,
    ...input.baseHeaders,
  };
  // Continues the bound trace into shj3-ai (observability/trace-context.ts). Mutates
  // `headers` in place rather than returning a value, so it composes with the object
  // literal above instead of replacing it.
  injectTraceparent(traceId, headers);

  let response: Response;
  try {
    response = await input.doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    // A timeout and a refused connection are different operational faults and are
    // reported as different codes, because the response to each is different: wait
    // versus check whether the service is up.
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("[ai-client] transport failure", {
      traceId,
      path: input.path,
      reason: timedOut ? "timeout" : "unreachable",
    });
    throw new AiServiceError(
      timedOut ? "upstream.timeout" : "upstream.unavailable",
      timedOut ? 504 : 503,
      traceId,
      input.path,
    );
  }

  if (!response.ok) {
    const problem = await problemDetailsFrom(response, traceId, input.path);
    throw new AiServiceError(
      problem.code,
      response.status,
      traceId,
      input.path,
      problem.mcpConnectFailureReason,
    );
  }

  return (await response.json()) as TResponse;
}

export function createAiClient(options: AiClientOptions = {}): AiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return {
    // Declared `async` deliberately, even though the body is one `return` — a *synchronous*
    // throw from `platformToken()` (a missing env var) must still surface as a rejected
    // promise, not a thrown exception from calling `.post()` itself, matching this
    // function's pre-refactor behaviour exactly (it was `async post(...)` before `performPost`
    // was extracted) and what every existing caller/test already assumes.
    async post<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
      return performPost<TResponse>({
        path,
        body,
        baseUrlOverride: options.baseUrl,
        timeoutMs,
        doFetch,
        baseHeaders: {
          "X-SHJ3-Platform-Token": platformToken(),
          // The tenant is in the body, not a header: provisioning acts *on* a tenant rather
          // than *as* one, and there is no principal it could have been resolved from
          // (api.md §5's header is for tenant-scoped calls — see createTenantScopedAiClient).
          "X-SHJ3-Platform-Scope": "provisioning",
        },
      });
    },
  };
}

/**
 * The tenant-scoped counterpart — a real bound principal exists, so the call carries
 * *its* identity (api.md §5's header table) rather than the platform credential. Reads
 * `requirePrincipal()` inside `post()`, not at construction time, for the same reason
 * `createAiClient`'s `post()` re-reads `requireTenantContext()` per call: the object this
 * factory returns is safe to hold as a long-lived singleton across many requests, each with
 * its own bound context.
 */
export function createTenantScopedAiClient(options: AiClientOptions = {}): AiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return {
    // `async` for the identical reason `createAiClient`'s `post()` is — `requirePrincipal()`
    // throwing synchronously (no bound principal) must surface as a rejected promise.
    async post<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
      const principal = requirePrincipal(`ai service call ${path}`);
      return performPost<TResponse>({
        path,
        body,
        baseUrlOverride: options.baseUrl,
        timeoutMs,
        doFetch,
        baseHeaders: {
          "X-SHJ3-Tenant-Id": principal.tenant,
          "X-SHJ3-Principal-Id": principal.id,
          "X-SHJ3-Permissions": [...principal.permissions].join(" "),
        },
      });
    },
  };
}

interface ProblemDetails {
  readonly code: string;
  readonly mcpConnectFailureReason?: McpConnectFailureReason;
}

/**
 * The stable error code (or a status-derived fallback), plus — for exactly
 * `tools.mcp_connect_failed` — the validated `meta.reason` (api.md §5.6).
 *
 * Only `code` and this one closed-set `meta.reason` are read. `title` and `detail` are
 * documented as display-safe, but they are written by the far side's serialiser and this
 * hop's job is to not become the route by which a Neo4j or Qdrant message reaches a
 * client (api.md §2.4) — `meta` as a whole stays unread beyond this one validated field.
 * The upstream detail is logged once, against the trace id, which is where an operator
 * looks anyway.
 */
async function problemDetailsFrom(
  response: Response,
  traceId: string,
  path: string,
): Promise<ProblemDetails> {
  const fallback = STATUS_FALLBACK_CODES[response.status] ?? "upstream.invalid_response";

  let problem: unknown;
  try {
    problem = await response.json();
  } catch {
    return { code: fallback };
  }

  console.error("[ai-client] upstream error", { traceId, path, status: response.status, problem });

  // `apps/ai`'s routers raise FastAPI's `HTTPException(status_code=..., detail={"code":
  // ...})` (every route that raises a structured error does — confirmed directly, not
  // assumed, by a real request against a real running `tools_router.py` during this
  // wave's own live verification). Starlette's default handler serialises that as
  // `{"detail": {"code": ..., ...}}`, **not** api.md §2.1's flat `{code, ...}` problem-
  // document shape — a real, previously-latent gap between the documented wire contract
  // and every route's actual output, not something specific to one endpoint. Unwrapped
  // here, once, for every caller of this client, rather than requiring every route to
  // switch to a custom response envelope.
  const envelope = unwrapFastApiDetail(problem);

  if (typeof envelope !== "object" || envelope === null) return { code: fallback };
  const code = (envelope as { code?: unknown }).code;
  if (typeof code !== "string" || !SHJ3_ERROR_CODE.test(code)) return { code: fallback };

  if (code !== "tools.mcp_connect_failed") return { code };

  const meta = (envelope as { meta?: unknown }).meta;
  const reason =
    typeof meta === "object" && meta !== null ? (meta as { reason?: unknown }).reason : undefined;
  if (
    typeof reason === "string" &&
    (MCP_CONNECT_FAILURE_REASONS as readonly string[]).includes(reason)
  ) {
    return { code, mcpConnectFailureReason: reason as McpConnectFailureReason };
  }
  return { code };
}

/**
 * `{"detail": {"code": ...}}` (FastAPI's real default envelope for a dict-valued
 * `HTTPException.detail`) unwraps to `{"code": ...}`; an already-flat `{"code": ...}`
 * body passes through unchanged, so a route that *does* return api.md §2.1's documented
 * shape directly (or a future custom exception handler that flattens it) needs no change
 * here either.
 */
function unwrapFastApiDetail(problem: unknown): unknown {
  if (typeof problem !== "object" || problem === null) return problem;
  if ("code" in problem) return problem;
  const detail = (problem as { detail?: unknown }).detail;
  return typeof detail === "object" && detail !== null && "code" in detail ? detail : problem;
}

/**
 * The citizen-scoped counterpart — B-6's conversation module is the first
 * caller. There is no staff `Principal` on this path (the request is
 * anonymous or resolved to a citizen `SessionRecord`, `iam/domain/session.ts`,
 * never to `platform/tenancy/tenant-context.ts`'s `Principal`), so this reads
 * the bound `TenantContext.tenant` directly rather than through
 * `requirePrincipal()` (which throws for exactly this — legitimately
 * anonymous — case) and takes the acting subject id as a parameter instead.
 *
 * `X-SHJ3-Permissions` is deliberately absent: api.md §5's header table scopes
 * it to "backoffice-originated calls only," and a citizen turn carries none.
 *
 * `X-SHJ3-Assurance`'s wire vocabulary (`anonymous | identified | verified |
 * verified_otp`, api.md §5) is a *different* naming scheme from
 * `iam/domain/assurance.ts`'s `L0`-`L3` ladder — flagged here rather than
 * silently mapped, since B-6 only ever produces `L0` (no verification flow is
 * wired yet; that is B-11's job) and a real `L1`-`L3` mapping has no caller to
 * prove it against yet. `assuranceLevelToWireValue` below covers only the
 * cases this wave can actually exercise and throws on the rest, so a future
 * caller supplying `L1`+ fails loudly instead of silently mislabelling
 * assurance on the one hop that decides whether a tool call may proceed.
 */
export function assuranceLevelToWireValue(level: "L0" | "L1" | "L2" | "L3"): string {
  if (level === "L0") return "anonymous";
  throw new Error(
    `assuranceLevelToWireValue("${level}"): no B-11 step-up flow exists yet to have produced ` +
      "this level for a real citizen session — extend this mapping when one does, rather than " +
      "guessing at api.md §5's identified/verified/verified_otp distinction now.",
  );
}

/**
 * `citizenSubjectId` is the acting `SessionRecord.subjectId` (a per-session
 * opaque id today — no `CitizenIdentity` row exists until a citizen actually
 * verifies, which is B-11's job) and is bound at construction time, not
 * threaded through every `post()` call: a citizen client is naturally built
 * fresh per request from the already-resolved session (`withCitizenSession`'s
 * handler), so there is no long-lived singleton to share across subjects the
 * way `getTenantScopedAiClient()` shares one across staff requests each
 * re-resolving their own principal.
 */
export function createCitizenScopedAiClient(
  citizenSubjectId: string,
  options: AiClientOptions = {},
): AiClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return {
    async post<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
      const context = requireTenantContext(`ai service call ${path}`);
      return performPost<TResponse>({
        path,
        body,
        baseUrlOverride: options.baseUrl,
        timeoutMs,
        doFetch,
        baseHeaders: {
          "X-SHJ3-Tenant-Id": context.tenant,
          "X-SHJ3-Principal-Id": `cs_${citizenSubjectId}`,
          "X-SHJ3-Assurance": assuranceLevelToWireValue("L0"),
        },
      });
    },
  };
}

/**
 * The streaming counterpart of `performPost` — same URL/header construction
 * and the same transport-failure translation, but returns the raw `Response`
 * instead of parsing JSON, because an SSE body must be piped through
 * (`ReadableStream`), not buffered. `shj3-web`'s public turn route is the only
 * caller: api.md §4.3 — "`shj3-web` ... opens `POST /v1/conversations/{id}/turns`
 * on `shj3-ai` and pipes the SSE stream through, event for event."
 *
 * Error bodies are still translated the same way as `performPost` for a
 * non-2xx response *before* streaming begins — a request that fails outright
 * (bad tenant header, agent not found) never reaches the point of piping
 * anything, so `AiServiceError` here carries the identical guarantee: no
 * vendor/upstream detail crosses the hop.
 */
export async function postAiTurnStream(input: {
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly citizenSubjectId: string;
  readonly options?: AiClientOptions;
}): Promise<Response> {
  const context = requireTenantContext(`ai service stream ${input.path}`);
  const { traceId } = context;
  const doFetch = input.options?.fetch ?? globalThis.fetch;
  const timeoutMs = resolveTimeout(input.options?.timeoutMs);
  const url = `${baseUrl(input.options?.baseUrl)}${API_PREFIX}${input.path}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    "X-Request-Id": traceId,
    "X-SHJ3-Tenant-Id": context.tenant,
    "X-SHJ3-Principal-Id": `cs_${input.citizenSubjectId}`,
    "X-SHJ3-Assurance": assuranceLevelToWireValue("L0"),
  };
  injectTraceparent(traceId, headers);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("[ai-client] transport failure (stream)", {
      traceId,
      path: input.path,
      reason: timedOut ? "timeout" : "unreachable",
    });
    throw new AiServiceError(
      timedOut ? "upstream.timeout" : "upstream.unavailable",
      timedOut ? 504 : 503,
      traceId,
      input.path,
    );
  }

  if (!response.ok) {
    const problem = await problemDetailsFrom(response, traceId, input.path);
    throw new AiServiceError(problem.code, response.status, traceId, input.path);
  }

  return response;
}

let shared: AiClient | null = null;

/** The process-wide platform-scoped client. Lazy so a missing base URL fails at first use, not at import. */
export function getAiClient(): AiClient {
  shared ??= createAiClient();
  return shared;
}

let sharedTenantScoped: AiClient | null = null;

/** The process-wide tenant-scoped client — safe to share across requests, since `post()` re-resolves the bound principal/tenant on every call. */
export function getTenantScopedAiClient(): AiClient {
  sharedTenantScoped ??= createTenantScopedAiClient();
  return sharedTenantScoped;
}
