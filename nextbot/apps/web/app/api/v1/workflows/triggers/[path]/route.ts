import { NextResponse, type NextRequest } from "next/server";
import { getCredentialForDecrypt } from "@nextbot/connectors";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { resolveTenantBySlug } from "@nextbot/tenancy";
import { handleWorkflowWebhookTrigger, type TriggerSecretResolver } from "@nextbot/workflows";
import type { TenantContext } from "@nextbot/db";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/workflows/triggers/{path}` — Target Architecture Blueprint Phase 16
 * (BL-47b), LLD §14.6.5's "the Webhook trigger surface, signature-verified".
 *
 * **This is the only endpoint in this phase with no session.** It is authenticated
 * instead by an HMAC-SHA256 signature over the raw body, keyed to the credential the
 * `TriggerNode` itself declares — `@nextbot/contracts`' `WebhookSource` makes
 * `signatureCredentialId` a REQUIRED field with the comment "never unauthenticated", and
 * this route plus `run-service.ts`'s `verifySignature` are where that holds at run time.
 *
 * Security properties, each deliberate:
 *
 *  - **The raw body is read once, as text, and verified before it is parsed.** A
 *    signature must be checked against the bytes that were signed, not against a
 *    re-serialization of a parse of them.
 *  - **Only `Production` versions are reachable** (`listProductionWorkflowVersions`), so
 *    an in-review workflow cannot be invoked by anyone who guesses its path. Promoting a
 *    version is what makes its endpoint live.
 *  - **No enumeration.** An unknown tenant slug, an unknown trigger path, a missing
 *    signature, an unresolvable credential and a wrong signature are deliberately NOT
 *    distinguishable to the caller: the first two are a bare `404` with no detail, the
 *    last three a bare `401`. Which one applied is knowable server-side only.
 *  - **Constant-time comparison** (`timingSafeEqual`, in `run-service.ts`).
 *  - **The response carries only the run id.** An external caller needs it to correlate
 *    its delivery and has no business reading the run's state, cost or trigger kind —
 *    those are admin-surface concerns behind RBAC.
 *
 * **Disclosed addition to LLD §14.6.5's path.** The specified path carries no tenant
 * discriminator, and a trigger path is only unique within a tenant, so the tenant is
 * taken from a required `X-NextBot-Tenant` header (the tenant slug) — the same
 * tenant-in-the-request convention `/api/scim/v2/{tenantSlug}` and
 * `/api/sso/{tenantSlug}` already use, expressed as a header rather than a path segment
 * so the LLD's literal path shape is preserved. An absent or unknown slug is the same
 * generic `404` as an unknown path, so this cannot be used to enumerate tenants either.
 */

/** No-store: a webhook delivery must never be served from a cache, and a `200` for one
 *  caller must never be replayed to another. */
export const dynamic = "force-dynamic";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

/** Resolves a `TriggerNode.signatureCredentialId` to its plaintext shared secret through
 *  the Phase 4 vault. Supplied by this composition root (rather than reached for inside
 *  `@nextbot/workflows`) so that module needs no `secrets`/`connectors` dependency, and
 *  so the plaintext exists only inside this closure for the duration of one verification. */
function createTriggerSecretResolver(ctx: TenantContext): TriggerSecretResolver {
  return {
    async resolve(credentialId: string): Promise<string | null> {
      const encrypted = await getCredentialForDecrypt(ctx, credentialId);
      if (!encrypted) return null;
      return getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, { tenantId: ctx.tenantId, kind: "connector-credential", id: credentialId });
    },
  };
}

const NOT_FOUND = NextResponse.json({ type: "about:blank", title: "No workflow trigger is configured at this path.", status: 404 }, { status: 404 });

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;

  const slug = request.headers.get("x-nextbot-tenant")?.trim();
  if (!slug) return NOT_FOUND;
  const tenant = await resolveTenantBySlug(slug);
  // An inactive/suspended tenant's triggers are dead, and are reported identically to a
  // nonexistent one.
  if (!tenant || tenant.status === "Suspended") return NOT_FOUND;

  const ctx: TenantContext = { tenantId: tenant.id, region: tenant.region, environment: "Production" };

  // Read the RAW body exactly once, before any parse — the signature covers these bytes.
  const rawBody = await request.text();

  try {
    const result = await handleWorkflowWebhookTrigger(ctx, createTriggerSecretResolver(ctx), {
      path,
      rawBody,
      signature: request.headers.get("x-nextbot-signature"),
      idempotencyKey: request.headers.get("idempotency-key"),
    });
    // `202 Accepted`, not `201`: the run has been durably recorded but nothing has
    // executed yet — `workflow.run-pump` claims it on its next tick. Reporting `201
    // Created` would imply the work is done.
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return problemResponse(err);
  }
}
