import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { RegisterModelProviderRequestSchema } from "@nextbot/contracts";
import { handleListModelProviders, handleRegisterModelProvider } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/model-providers` (RBAC: agent_platform=Read).
 *
 * **Regression-prevention note (Target Architecture Blueprint Phase 1):** the
 * pre-existing v1 `ModelGateway` console screen (`apps/web/app/(admin)/agent-platform/
 * model-gateway/ModelGateway.tsx`) reads this response shape as
 * `{ key, label, baseUrl, regions, enabled }` — the column names *before* this phase's
 * `model_provider` migration (`type`/`name`/`regions_served`). Mapped back to the old
 * field names here, at this legacy API boundary only, so that already-shipped,
 * QA-verified screen keeps rendering unchanged; the new Provider Registry screens use
 * the new field names directly via `/api/v1/admin/model-gateway/providers`. */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const rows = await handleListModelProviders(guard.ctx);
  const providers = rows.map((r) => ({
    id: r.id,
    key: r.type,
    label: r.name,
    baseUrl: r.baseUrl,
    regions: r.regionsServed,
    enabled: r.enabled,
  }));
  return NextResponse.json({ providers });
}

/** `POST /api/v1/admin/agent-platform/model-providers` (RBAC: agent_platform=Write).
 *
 * Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8.7) — this v1
 * upsert-by-`(tenant, type)` path now always registers a row scoped to the calling
 * tenant (`tenant_id = ctx.tenantId`), not a platform-wide row — writing a
 * `tenant_id IS NULL` platform row requires `withPlatform()`, callable only from
 * tenancy provisioning / `/api/internal/ops/**` (LLD §3.2 rule 4), which this
 * tenant-session admin endpoint is neither. The pre-existing platform-registered
 * provider (seeded before this migration) is unaffected and keeps resolving for every
 * tenant exactly as before. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(RegisterModelProviderRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model provider payload.", status: 422 }, { status: 422 });
  }
  try {
    // Note: this v1 path still does not vault `apiKey` into a `credentialId` before
    // registration (unchanged from before this migration) — a provider registered
    // with a plaintext `apiKey` in this request is not yet persisted anywhere by
    // `registerModelProvider` (it only accepts `credentialId`), so this is flagged
    // rather than silently dropped. The new Provider Registry CRUD surface
    // (`/api/v1/admin/model-gateway/providers`) DOES vault a plaintext key on create —
    // that's this phase's actual FR-AGT-20 credential-entry path; this v1 endpoint is
    // kept working unchanged for backward compatibility only.
    const provider = await handleRegisterModelProvider(guard.ctx, body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
