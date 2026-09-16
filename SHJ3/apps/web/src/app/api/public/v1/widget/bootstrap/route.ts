/**
 * `GET /api/public/v1/widget/bootstrap?channelKey=...&locale=...` (api.md
 * §4.2) — everything the widget needs to paint before anything else loads:
 * greeting/disclaimer/composer copy, chips, resolved theme tokens, and
 * whether TTS/handover are currently offered.
 *
 * Error handling is deliberately nested: any error raised **inside** the
 * `withAnonymousChannel` callback is caught right there so the response can
 * carry the *real*, request-bound `traceId`; only a failure *before* the
 * tenant context ever binds (a malformed `channelKey`, or a forged-tenant
 * rejection thrown by `assertNoTenantOverride` before `AuthMiddleware`
 * computes a trace id at all) falls through to the outer catch, which mints
 * a fresh fallback id for that one response. Every other route in this
 * module repeats this same two-layer shape for the identical reason.
 */

import { hasLocale } from "next-intl";
import {
  InvalidChannelKeyError,
  parseChannelKey,
} from "../../../../../../modules/conversation/domain/channel-key.js";
import { withAnonymousChannel } from "../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { ResolveTheme } from "../../../../../../modules/theming/application/resolve-theme.js";
import { PrismaThemeRepository } from "../../../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import { routing } from "../../../../../../i18n/routing.js";
import { dbDirectionForLocale, type AppLocale } from "../../../../../../i18n/locale-direction.js";
import { GetWidgetBootstrap } from "../../../../../../modules/conversation/application/get-widget-bootstrap.js";
import { assertOriginAllowed } from "../../../../../../modules/conversation/domain/origin-allowlist.js";
import { quickActionRepository, widgetChannelRepository } from "../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../_lib/problem.js";

const INSTANCE = "/api/public/v1/widget/bootstrap";

function resolveLocale(raw: string | null): AppLocale {
  return raw && hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const url = new URL(request.url);
  const locale = resolveLocale(url.searchParams.get("locale"));

  let parsed: ReturnType<typeof parseChannelKey>;
  try {
    parsed = parseChannelKey(url.searchParams.get("channelKey"));
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
          const bootstrap = await new GetWidgetBootstrap({
            widgetChannels: widgetChannelRepository(),
            quickActions: quickActionRepository(),
          }).execute({ channelKind: parsed.channelKind, localeCode: locale });

          assertOriginAllowed(request.headers.get("origin"), bootstrap.allowedDomains, {
            refererHeader: request.headers.get("referer"),
            requestOrigin: new URL(request.url).origin,
          });

          const theme = await new ResolveTheme(new PrismaThemeRepository()).execute({
            staffUserId: null,
            localeDirection: dbDirectionForLocale(locale),
            prefersDarkSignal: { clientHint: null, cookie: null },
          });

          const body = {
            greetingText: bootstrap.greetingText,
            disclaimerText: bootstrap.disclaimerText,
            showDisclaimerDismiss: bootstrap.showDisclaimerDismiss,
            composerPlaceholder: bootstrap.composerPlaceholder,
            accentTokenKey: bootstrap.accentTokenKey,
            launcherPosition: bootstrap.launcherPosition,
            defaultState: bootstrap.defaultState,
            locale,
            direction: theme.direction,
            theme: { mode: theme.mode, density: theme.density, colorTokens: theme.colorTokens },
            chips: bootstrap.chips,
            // Real, if simple: TTS is the browser SpeechSynthesis substitute
            // (this module's own brief — no backend TTS endpoint exists yet),
            // "offered" whenever the channel is Live; handover hours-of-day
            // availability is evaluated at request time by the handover
            // endpoint itself, not pre-announced here.
            ttsOffered: bootstrap.channelState === "Live",
            handoverOffered: bootstrap.channelState === "Live",
          };

          const etag = `W/"bootstrap-${Buffer.from(JSON.stringify(body)).toString("base64url").slice(0, 24)}"`;
          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, {
              status: 304,
              headers: { etag, "x-request-id": requestId },
            });
          }

          return new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "public, max-age=60",
              etag,
              "x-request-id": requestId,
              "x-trace-id": traceId,
            },
          });
        } catch (innerError) {
          return problemResponse(errorToProblem(innerError, traceId, INSTANCE), requestId);
        }
      },
      { query: Object.fromEntries(url.searchParams) },
    );
  } catch (outerError) {
    return problemResponse(errorToProblem(outerError, newFallbackTraceId(), INSTANCE), requestId);
  }
}
