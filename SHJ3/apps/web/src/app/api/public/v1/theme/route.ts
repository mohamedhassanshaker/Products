/** `GET /api/public/v1/theme?channelKey=...&locale=...` (api.md §4.2, §7.3) — resolved token set for the widget: tenant -> system only, no user tier (a citizen has no stored preference). */

import { hasLocale } from "next-intl";
import {
  InvalidChannelKeyError,
  parseChannelKey,
} from "../../../../../modules/conversation/domain/channel-key.js";
import { withAnonymousChannel } from "../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { ResolveTheme } from "../../../../../modules/theming/application/resolve-theme.js";
import { PrismaThemeRepository } from "../../../../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import { routing } from "../../../../../i18n/routing.js";
import { dbDirectionForLocale, type AppLocale } from "../../../../../i18n/locale-direction.js";
import { assertOriginAllowedForChannelKind } from "../_lib/origin-check.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../_lib/problem.js";

const INSTANCE = "/api/public/v1/theme";

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
          await assertOriginAllowedForChannelKind(request, parsed.channelKind);

          const theme = await new ResolveTheme(new PrismaThemeRepository()).execute({
            staffUserId: null,
            localeDirection: dbDirectionForLocale(locale),
            prefersDarkSignal: { clientHint: null, cookie: null },
          });

          const body = {
            resolvedAt: new Date().toISOString(),
            tokens: theme.colorTokens,
            mode: theme.mode,
            direction: theme.direction,
            density: theme.density,
          };
          const etag = `W/"theme-${Buffer.from(JSON.stringify(body)).toString("base64url").slice(0, 24)}"`;
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
