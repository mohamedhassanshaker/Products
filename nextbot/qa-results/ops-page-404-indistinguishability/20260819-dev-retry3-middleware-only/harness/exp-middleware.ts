import { NextResponse, type NextRequest } from "next/server";
import { isPlatformOpsConfigured, isRequestFromAllowedNetwork } from "@/src/lib/platform-ops-network";

/** EXPERIMENT ONLY — measures NextResponse.rewrite() from middleware. Not shipped. */
export const config = {
  matcher: ["/internal/ops", "/internal/ops/:path*"],
};

export function middleware(request: NextRequest): NextResponse {
  const allowed = isPlatformOpsConfigured() && isRequestFromAllowedNetwork(request.headers);
  if (allowed) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = "/__nb_route_absent__" + request.nextUrl.pathname;
  const res = NextResponse.rewrite(target);
  if (request.headers.get("x-nbexp") === "del") res.headers.delete("x-middleware-rewrite");
  return res;
}
