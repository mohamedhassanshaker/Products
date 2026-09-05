import { NextResponse } from "next/server";
import { corsHeaders } from "./cors.js";

/**
 * RFC 9457 problem+json 429 response for a rate-limited widget request (BE2),
 * mirroring `problem-response.ts`'s shape/CORS-header convention. `Retry-After`
 * tells a well-behaved client how long to back off before retrying, rather than
 * hammering the endpoint immediately again.
 */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return NextResponse.json(
    {
      type: "about:blank",
      title: "Too many requests — please slow down and try again shortly.",
      status: 429,
    },
    {
      status: 429,
      headers: { ...corsHeaders(), "Retry-After": String(retryAfterSeconds) },
    },
  );
}
