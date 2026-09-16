/**
 * `POST /api/public/v1/conversations` (api.md §4.2) — open a conversation,
 * mint the citizen session, set `shj3_cs`.
 *
 * ## `SameSite=None; Secure`, not `SameSite=Lax` — a real live-browser bug,
 * not a style choice
 *
 * The widget is, by this wave's own architecture, embedded directly in a
 * third-party page's own origin (`widget-embed/main.ts`'s module comment) —
 * every one of its `fetch()` calls to this API is therefore genuinely
 * cross-site. A `SameSite=Lax` cookie (the first draft here, and the
 * ordinary safe default for same-site apps) is **never sent on a cross-site
 * fetch/XHR at all**, only on a top-level navigation — found only by driving
 * a real Chromium browser through a real embed on a real different origin
 * during this wave's integration pass: every subsequent `POST .../turns`
 * came back a real `401`, because the citizen session cookie this same
 * response had just set was silently withheld by the browser on the very
 * next cross-site request. `curl` (which does not implement `SameSite` at
 * all) could never have caught this.
 *
 * `SameSite=None` is required to make a cross-site cookie eligible at all,
 * and every browser refuses to honour `SameSite=None` without `Secure` in
 * the same header — so both attributes go together, always, never
 * conditionally on `NODE_ENV`. The remaining wrinkle is genuinely
 * environment-specific, not a choice: a `Secure` cookie is never sent over a
 * plain `http://` connection by any browser, so a *local* `next dev` served
 * over bare HTTP cannot exercise the cross-site path at all regardless of
 * this fix — `citizenSessionSetCookie` below still sets `SameSite=Lax` (no
 * `Secure`) for that one case, which is what keeps the same-origin SSR demo
 * page (`/{locale}/widget`) working locally over HTTP; a real cross-site
 * embed proof needs either a deployed HTTPS environment or a local TLS proxy
 * (mkcert/ngrok), named here rather than silently assumed provable over
 * plain HTTP.
 */

import {
  InvalidChannelKeyError,
  parseChannelKey,
} from "../../../../../modules/conversation/domain/channel-key.js";
import { withAnonymousChannel } from "../../../../../modules/iam/adapters/inbound/public-request-context.js";
import {
  CITIZEN_SESSION_COOKIE,
  formatSessionCookie,
} from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import {
  CITIZEN_SESSION_TTL,
  clientBindingOf,
  remainingTtlSeconds,
} from "../../../../../modules/iam/domain/session.js";
import { OpenConversation } from "../../../../../modules/conversation/application/open-conversation.js";
import { assertOriginAllowed } from "../../../../../modules/conversation/domain/origin-allowlist.js";
import {
  conversationRepository,
  quickActionRepository,
  sessionStore,
  widgetChannelRepository,
} from "../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../_lib/problem.js";

const INSTANCE = "/api/public/v1/conversations";

/**
 * Was the *original* client request over HTTPS? `request.url`'s own protocol
 * reflects Next's internal proxy hop (usually `http:` even in a real deployed
 * environment terminating TLS upstream), so the real signal is the standard
 * `X-Forwarded-Proto` header a TLS-terminating proxy/load balancer sets —
 * falling back to the request URL's own protocol only for the case nothing
 * sits in front of this process at all (a bare local `next dev`).
 */
function requestWasHttps(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0]?.trim().toLowerCase() === "https";
  return new URL(request.url).protocol === "https:";
}

/** See the module comment above for why this cannot be a fixed `SameSite=Lax`/`; Secure` pair. */
function citizenSessionSetCookie(
  cookieValue: string,
  maxAgeSeconds: number,
  request: Request,
): string {
  const base = `${CITIZEN_SESSION_COOKIE}=${cookieValue}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly`;
  return requestWasHttps(request) ? `${base}; SameSite=None; Secure` : `${base}; SameSite=Lax`;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse(
      {
        status: 400,
        code: "request.malformed_body",
        title: "Malformed Body",
        traceId: newFallbackTraceId(),
        instance: INSTANCE,
      },
      requestId,
    );
  }

  const channelKeyRaw = (body as { channelKey?: unknown } | null)?.channelKey;

  let parsed: ReturnType<typeof parseChannelKey>;
  try {
    parsed = parseChannelKey(channelKeyRaw);
  } catch (error) {
    if (error instanceof InvalidChannelKeyError) {
      return problemResponse(
        {
          status: 404,
          code: "conversation.channel_not_found",
          title: "Channel Not Found",
          traceId: newFallbackTraceId(),
          instance: INSTANCE,
        },
        requestId,
      );
    }
    throw error;
  }

  try {
    return await withAnonymousChannel(
      request,
      parsed.tenant,
      async ({ traceId }) => {
        try {
          const allowedDomains = await (async () => {
            const channel = await widgetChannelRepository().findChannelByKind(parsed.channelKind);
            return channel ? widgetChannelRepository().listAllowedDomains(channel.channelId) : [];
          })();
          assertOriginAllowed(request.headers.get("origin"), allowedDomains, {
            refererHeader: request.headers.get("referer"),
            requestOrigin: new URL(request.url).origin,
          });

          const now = new Date();
          const binding = clientBindingOf(
            request.headers.get("user-agent"),
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          );

          const result = await new OpenConversation({
            conversations: conversationRepository(),
            widgetChannels: widgetChannelRepository(),
            quickActions: quickActionRepository(),
            sessions: sessionStore(),
          }).execute({
            channelKind: parsed.channelKind,
            localeCode:
              typeof (body as { locale?: unknown })?.locale === "string"
                ? (body as { locale: string }).locale
                : "en",
            tenant: parsed.tenant,
            binding,
            now,
          });

          const maxAge = remainingTtlSeconds(result.session, CITIZEN_SESSION_TTL, now);
          const cookieValue = formatSessionCookie(parsed.tenant, result.session.id);
          const setCookie = citizenSessionSetCookie(cookieValue, maxAge, request);

          const responseBody = {
            conversationId: result.conversationId,
            greeting: {
              role: "assistant",
              content: result.greeting.text,
              disclaimerText: result.greeting.disclaimerText,
              showDisclaimerDismiss: result.greeting.showDisclaimerDismiss,
            },
            chips: result.chips,
          };

          return new Response(JSON.stringify(responseBody), {
            status: 201,
            headers: {
              "content-type": "application/json",
              "set-cookie": setCookie,
              "x-request-id": requestId,
              "x-trace-id": traceId,
              location: `/api/public/v1/conversations/${result.conversationId}`,
            },
          });
        } catch (innerError) {
          // ChannelDisabledError (`403 conversation.channel_disabled`) and every
          // other application error share the same generic mapping below —
          // `errorToProblem` reads `.code`/`.status` off any of them uniformly.
          return problemResponse(errorToProblem(innerError, traceId, INSTANCE), requestId);
        }
      },
      { body },
    );
  } catch (outerError) {
    return problemResponse(errorToProblem(outerError, newFallbackTraceId(), INSTANCE), requestId);
  }
}
