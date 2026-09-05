import type {
  CreateWidgetSessionRequest,
  CreateWidgetSessionResult,
  MessageContentTypeValue,
  MessagePayload,
  SendWidgetMessageResult,
} from "@nextbot/contracts";

/** Build-time configurable Gateway Plane base URL (`apps/gateway`, LLD §5.1's
 * `/api/v1/widget/**` surface) — defaults to the local dev port
 * (`apps/gateway/package.json`'s `dev -p 4001`) so `pnpm --filter
 * nextbot-widget-embed dev` works against a locally-running gateway with zero
 * config. Production deployment wires the real value via `VITE_NEXTBOT_GATEWAY_URL`
 * at build time (nexus-deploy scope). */
const GATEWAY_BASE_URL: string = (import.meta.env.VITE_NEXTBOT_GATEWAY_URL as string | undefined) ?? "http://localhost:4001";

export class WidgetApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function parseErrorTitle(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.title ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

export async function createWidgetSession(input: CreateWidgetSessionRequest): Promise<CreateWidgetSessionResult> {
  const res = await fetch(`${GATEWAY_BASE_URL}/api/v1/widget/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new WidgetApiError(res.status, await parseErrorTitle(res));
  return res.json();
}

export async function sendWidgetMessage(
  sessionToken: string,
  input: { clientMessageId: string; contentType: MessageContentTypeValue; payload: MessagePayload },
): Promise<SendWidgetMessageResult> {
  const res = await fetch(`${GATEWAY_BASE_URL}/api/v1/widget/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
      "idempotency-key": input.clientMessageId,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new WidgetApiError(res.status, await parseErrorTitle(res));
  return res.json();
}

/** Phase 14 (BL-08) — Tier-2 customer Confirm/Cancel (LLD §6.4). `Idempotency-Key`
 * is a fresh client-generated id per attempt (a double-click resends the same
 * decision with a *new* key, which is fine: the server's CAS-claim, not this
 * header, is what actually prevents double-execution — see `decideTier2`'s doc). */
export async function confirmToolCall(sessionToken: string, toolCallId: string, decision: "Confirm" | "Cancel"): Promise<{ toolCallId: string; status: string }> {
  const res = await fetch(`${GATEWAY_BASE_URL}/api/v1/widget/tool-calls/${toolCallId}/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new WidgetApiError(res.status, await parseErrorTitle(res));
  return res.json();
}

export async function setWidgetLanguage(sessionToken: string, language: string): Promise<void> {
  const res = await fetch(`${GATEWAY_BASE_URL}/api/v1/widget/language`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ language }),
  });
  if (!res.ok) throw new WidgetApiError(res.status, await parseErrorTitle(res));
}

/** Opens the widget's SSE connection (LLD §5.3). `EventSource` cannot set a bearer
 * header, so the token travels as a `token` query param (see
 * `apps/gateway/src/lib/widget-auth.ts`'s `requireWidgetSessionFromStreamRequest`). */
export function openWidgetStream(sessionToken: string, sinceSequence: number): EventSource {
  const url = new URL(`${GATEWAY_BASE_URL}/api/v1/widget/stream`);
  url.searchParams.set("sinceSequence", String(sinceSequence));
  url.searchParams.set("token", sessionToken);
  return new EventSource(url.toString());
}
