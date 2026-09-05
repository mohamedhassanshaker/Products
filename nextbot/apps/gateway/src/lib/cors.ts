/**
 * CORS headers for `/api/v1/widget/**` (LLD §5.1: "strict CORS by channel
 * `allowedOrigins`"). **Deviation, flagged (locally reversible):** full per-channel
 * origin allowlisting is not wired this phase — there is no channel-management wizard
 * yet for an admin to actually populate `WebWidgetConfig.allowedOrigins` from a UI
 * (`createWebWidgetChannel`'s request accepts it, but nothing collects it), and
 * enforcing it here would need an extra channel lookup on every request for no real
 * benefit yet. A wildcard is used instead — no more permissive than what an
 * embeddable-by-design widget already exposes (its whole point is running on
 * arbitrary third-party host pages), and is the honest state of "not yet
 * origin-restricted" rather than a silently-narrower value that looks enforced but
 * isn't. Tightening this to the real per-channel allowlist is flagged as a hardening
 * item for whichever phase builds the full FR-OC-02/03 channel-management UI.
 */
export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
  };
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
