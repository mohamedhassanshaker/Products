import { NextResponse } from "next/server";
import { DomainError } from "@nextbot/contracts";
import { corsHeaders } from "./cors.js";

/**
 * Maps a thrown `DomainError` to an RFC 9457 problem+json response (LLD §11.2),
 * mirroring `apps/web/src/lib/api-guard.ts`'s `problemResponse` — duplicated rather
 * than imported since `apps/gateway` and `apps/web` are separate deployables (LLD
 * §2.1) with no shared "apps-internal-lib" package; both are thin composition-root
 * adapters over the same `@nextbot/contracts` `DomainError` hierarchy.
 */
export function problemResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return NextResponse.json(
      { type: "about:blank", title: err.message, status: err.httpStatus, code: err.code, fields: err.fields },
      { status: err.httpStatus, headers: corsHeaders() },
    );
  }
  // Never leak internal error detail to an anonymous, cross-origin caller.
  console.error(err);
  return NextResponse.json(
    { type: "about:blank", title: "An unexpected error occurred.", status: 500 },
    { status: 500, headers: corsHeaders() },
  );
}
