import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { AuthzSimulateRequestSchema } from "@nextbot/contracts";
import { handleSimulate } from "@nextbot/authz";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/authz/simulate` (RBAC: security_settings:Read — LLD
 * §14.2.7). Resolves the request's chain references to real `ScopeDescriptor`s
 * and runs them through the exact same evaluator the runtime uses (`simulate()`
 * delegates to `evaluateOrDeny()`, never a parallel approximation) — what a
 * future Team/Workflow/Studio editor's "this member can reach N of its M
 * declared tools" preview will call once those editors exist.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(AuthzSimulateRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid authz simulate request.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleSimulate(guard.ctx, body));
  } catch (err) {
    return problemResponse(err);
  }
}
