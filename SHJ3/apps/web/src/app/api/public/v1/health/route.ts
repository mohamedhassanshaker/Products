/** `GET /api/public/v1/health` (api.md §4.2) — shallow liveness only, no dependency detail: "a public endpoint must not report which store is down." No tenant context, no auth — the one endpoint on this surface exempt from the origin allow-list (api.md §4.1: "every request ... except the health check"). */

export function GET(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
