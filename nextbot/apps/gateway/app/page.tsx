/** Not a user-facing surface — the Gateway Plane exposes only `/api/v1/widget/**`
 * Route Handlers (LLD §5.1). This root page exists only to satisfy the App Router's
 * expectation of a routable root; nothing links to it. */
export default function GatewayRootPage() {
  return null;
}
