/**
 * Response shape for `GET /api/health` (liveness — no dependency I/O, HLD §12).
 */
export interface HealthLivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/** One dependency's readiness result, as reported by `GET /api/health/ready`. */
export interface ReadinessCheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * The AI engine's reachability, reported separately from `checks` (LLD §7.10, amended 2026-08-08).
 * Deliberately NON-FATAL to overall readiness in every state — "disabled" is an expected,
 * intentionally-permitted deployment shape (NFR-10: the app is genuinely usable without AI), and a
 * "degraded" engine must never take a healthy deployment out of the load balancer.
 */
export type AiReadinessState =
  | { state: 'disabled' }
  | { state: 'up'; breaker: 'closed'; lastSuccessAt: string | null }
  | { state: 'degraded'; breaker: 'open' | 'half-open'; lastSuccessAt: string | null; lastError: string };

/**
 * Response shape for `GET /api/health/ready` (readiness — pings dependencies, HLD §12). `status` is
 * `'ok'` only when every check in `checks` is `ok: true`; otherwise `'degraded'` and the endpoint
 * responds with a non-2xx status so orchestrators (e.g. Kubernetes) can act on it. `ai` is reported
 * alongside `checks` but is NEVER a factor in computing `status` (LLD §7.10).
 */
export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  checks: ReadinessCheckResult[];
  ai: AiReadinessState;
  timestamp: string;
}
