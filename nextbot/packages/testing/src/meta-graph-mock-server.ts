import { createServer, type Server, type ServerResponse } from "node:http";

/**
 * A minimal in-process stand-in for the Meta Graph API (WhatsApp Business
 * Platform) surface `packages/channel-adapters`' `meta-graph-client.ts` actually
 * calls — proving that client's real request/response handling end-to-end without
 * a live Meta App/System User token, the same rationale as
 * `startMockGitHubServer`/`startMockOpenAiCompatibleServer`.
 */
export interface MockMetaGraphState {
  businessInfo: Record<string, { id: string; name: string }>;
  phoneNumbers: Record<string, Array<Record<string, unknown>>>; // keyed by wabaId
  templates: Record<string, Array<Record<string, unknown>>>; // keyed by wabaId
  sentMessages: Array<{ phoneNumberId: string; body: Record<string, unknown> }>;
  /** Test hook: force the next send to fail with this status (simulates a Meta API
   * transport error, e.g. rate limiting). */
  nextSendStatus?: number;
}

export function createMockMetaGraphState(): MockMetaGraphState {
  return { businessInfo: {}, phoneNumbers: {}, templates: {}, sentMessages: [] };
}

export async function startMockMetaGraphServer(state: MockMetaGraphState): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const segments = url.pathname.split("/").filter(Boolean);

      // GET /{business-id}?fields=id,name
      if (req.method === "GET" && segments.length === 1 && url.searchParams.get("fields")?.includes("name") && !url.pathname.includes("phone_numbers") && !url.pathname.includes("message_templates")) {
        const info = state.businessInfo[segments[0]!];
        if (!info) return json(res, 404, { error: { message: "Unknown business id" } });
        return json(res, 200, info);
      }

      // GET /{waba-id}/phone_numbers
      if (req.method === "GET" && segments.length === 2 && segments[1] === "phone_numbers") {
        return json(res, 200, { data: state.phoneNumbers[segments[0]!] ?? [] });
      }

      // GET /{waba-id}/message_templates
      if (req.method === "GET" && segments.length === 2 && segments[1] === "message_templates") {
        return json(res, 200, { data: state.templates[segments[0]!] ?? [] });
      }

      // POST /{phone-number-id}/messages
      if (req.method === "POST" && segments.length === 2 && segments[1] === "messages") {
        if (state.nextSendStatus && state.nextSendStatus >= 400) {
          const status = state.nextSendStatus;
          state.nextSendStatus = undefined;
          return json(res, status, { error: { message: "Simulated Meta API failure" } });
        }
        state.sentMessages.push({ phoneNumberId: segments[0]!, body });
        return json(res, 200, { messages: [{ id: `wamid.mock-${state.sentMessages.length}` }] });
      }

      return json(res, 404, { error: { message: "Not found in mock Meta Graph server" } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
