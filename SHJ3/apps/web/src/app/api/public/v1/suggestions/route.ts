/**
 * `GET /api/public/v1/suggestions?channelKey=...&conversationId=...&locale=...`
 * (api.md §4.2). See `GetSuggestions`'s own doc comment for the honest
 * `conversationId` scope trim (this always returns the static, channel-scoped
 * `QuickAction` list — `conversationId` is accepted, per the contract, but
 * not yet used to narrow to a flow-node-specific set).
 */

import { hasLocale } from "next-intl";
import {
  InvalidChannelKeyError,
  parseChannelKey,
} from "../../../../../modules/conversation/domain/channel-key.js";
import { withAnonymousChannel } from "../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { GetSuggestions } from "../../../../../modules/conversation/application/get-suggestions.js";
import { assertOriginAllowedForChannelKind } from "../_lib/origin-check.js";
import { quickActionRepository } from "../_lib/composition.js";
import { routing } from "../../../../../i18n/routing.js";
import type { AppLocale } from "../../../../../i18n/locale-direction.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../_lib/problem.js";

const INSTANCE = "/api/public/v1/suggestions";

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
          const chips = await new GetSuggestions({ quickActions: quickActionRepository() }).execute(
            {
              channelKind: parsed.channelKind,
              localeCode: locale,
            },
          );
          return new Response(JSON.stringify({ data: chips }), {
            status: 200,
            headers: {
              "content-type": "application/json",
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
