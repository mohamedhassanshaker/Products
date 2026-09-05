/**
 * Redaction denylist applied to Pino serializers (LLD §10.7). Never log
 * secret values, Authorization headers, or refresh/access/room tokens.
 *
 * Shared between the public (`:8080`) and internal (`:8081`) Nest
 * applications so the "secrets never logged" guarantee holds platform-wide,
 * not just on the app that happened to wire it first (QA Phase 3 D-3 — the
 * internal app previously had zero logging/redaction wiring at all).
 */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-bootstrap-secret"]',
  'req.headers["idempotency-key"]',
  'req.body.password',
  'req.body.refresh_token',
  'req.body.token',
  // LiveKit conversation tokens (FR-AUTH-4 mint + FR-TRANSPORT-4 end-call
  // auth proof) must never be logged either (LLD §10.7).
  'res.body.token',
  'res.headers["set-cookie"]',
];
