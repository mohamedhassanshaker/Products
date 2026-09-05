import { NextResponse, type NextRequest } from "next/server";
import { handleVerifyWidgetSession } from "@nextbot/conversations";
import type { WidgetSessionClaims } from "@nextbot/conversations";
import { corsHeaders } from "./cors.js";

/**
 * Verifies the `Authorization: Bearer <sessionToken>` header every authenticated
 * `/api/v1/widget/**` endpoint requires (LLD §5.3) — the anonymous-widget-session
 * equivalent of `apps/web`'s `requireApi` RBAC guard. Returns either the decoded
 * claims or a `Response` to return immediately, same calling convention as
 * `requireApi` (`const auth = await requireWidgetSession(req); if (auth instanceof
 * Response) return auth;`).
 */
export async function requireWidgetSession(request: NextRequest): Promise<WidgetSessionClaims | Response> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return verifyOrUnauthorized(token);
}

/**
 * SSE-specific variant: the browser `EventSource` API cannot set custom request
 * headers, so the widget's `GET /stream` connection carries its session token as a
 * `token` query-string parameter instead of an `Authorization` header — a
 * well-established pattern for the same reason (e.g. how many SSE/WebSocket APIs
 * handle browser-initiated auth). Falls back to the header too, so a non-browser
 * caller (a test, a future native client) can still use the header form.
 */
export async function requireWidgetSessionFromStreamRequest(request: NextRequest): Promise<WidgetSessionClaims | Response> {
  const header = request.headers.get("authorization");
  const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const queryToken = request.nextUrl.searchParams.get("token");
  return verifyOrUnauthorized(headerToken ?? queryToken);
}

async function verifyOrUnauthorized(token: string | null): Promise<WidgetSessionClaims | Response> {
  if (!token) {
    return NextResponse.json(
      { type: "about:blank", title: "Missing bearer session token.", status: 401 },
      { status: 401, headers: corsHeaders() },
    );
  }
  try {
    return await handleVerifyWidgetSession(token);
  } catch {
    return NextResponse.json(
      { type: "about:blank", title: "Your chat session has expired. Please refresh the page.", status: 401 },
      { status: 401, headers: corsHeaders() },
    );
  }
}
