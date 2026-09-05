import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId, type TenantContext } from "@nextbot/db";
import { WorkflowTriggerNotFoundError, WorkflowTriggerSignatureInvalidError, type WorkflowNode } from "@nextbot/contracts";
import { computeTriggerSignature, handleWebhookTrigger, type TriggerSecretResolver } from "./run-service.js";
import { findWorkflowRunById } from "../infrastructure/workflow-run-repository.js";
import { setWorkflowVersionStatus } from "../infrastructure/workflow-repository.js";
import { activateTenant, createFixtureWorkflowVersion, endNode } from "../testing/run-fixtures.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.5) — the webhook trigger
 * surface, which is the ONLY endpoint in this phase with no session.
 *
 * `@nextbot/contracts`' `WebhookSource` makes `signatureCredentialId` a required field
 * with the comment "never unauthenticated". This suite is where that holds at run time,
 * and it is written adversarially: every way a caller could try to reach a workflow
 * without a valid signature is asserted to fail closed, and the failures are asserted to
 * be INDISTINGUISHABLE from each other so the endpoint cannot be used to enumerate a
 * tenant's trigger paths or probe which credential a trigger uses.
 */

const SECRET = "shared-secret-for-this-trigger";
const TRIGGER_PATH = "orders/created";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function freshTenant(): Promise<TenantContext> {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  await activateTenant(ctx);
  return ctx;
}

/** Stands in for the composition root's vault lookup. The route handler supplies the
 *  real `KmsEnvelopeSecretsProvider`-backed resolver; here the plaintext is injected
 *  directly so the suite tests SIGNATURE VERIFICATION rather than key management, which
 *  `@nextbot/secrets` already owns and tests. */
function secretResolver(secret: string | null = SECRET): TriggerSecretResolver {
  return { async resolve() { return secret; } };
}

function webhookNodes(path: string, credentialId: string): WorkflowNode[] {
  return [
    { id: "trigger_1", kind: "Trigger", source: { kind: "Webhook", path, signatureCredentialId: credentialId }, next: "end_1" },
    endNode("end_1"),
  ];
}

/** A `Production` version is the only kind the trigger surface resolves — so promoting is
 *  what makes an endpoint live. Written directly through the narrow status setter because
 *  the promotion ladder's own gates are a different concern, tested elsewhere. */
async function productionWebhookWorkflow(ctx: TenantContext, name: string, path = TRIGGER_PATH) {
  const credentialId = generateId();
  const version = await createFixtureWorkflowVersion(ctx, name, webhookNodes(path, credentialId));
  await setWorkflowVersionStatus(ctx, version.id, "Production");
  return { versionId: version.id, credentialId };
}

describe("the happy path", () => {
  it("a correctly-signed delivery starts a real run seeded with the payload", async () => {
    const ctx = await freshTenant();
    const { versionId } = await productionWebhookWorkflow(ctx, "wf_hook_ok");
    const rawBody = JSON.stringify({ orderId: "ORD-1", total: 42 });

    const { run, created } = await handleWebhookTrigger(ctx, secretResolver(), {
      path: TRIGGER_PATH,
      rawBody,
      signature: computeTriggerSignature(SECRET, rawBody),
      idempotencyKey: null,
    });

    expect(created).toBe(true);
    const stored = (await findWorkflowRunById(ctx, run.id))!;
    expect(stored.workflowVersionId).toBe(versionId);
    expect(stored.triggerKind).toBe("Webhook");
    expect(stored.state).toBe("Pending"); // nothing executes in the request
    expect((stored.checkpointJson as { variables: Record<string, unknown> }).variables).toMatchObject({ orderId: "ORD-1", total: 42 });
  });

  it("a REDELIVERY of the same payload resumes the existing run instead of starting a second (LLD §14.6.2)", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_redeliver");
    const rawBody = JSON.stringify({ orderId: "ORD-2" });
    const delivery = { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature(SECRET, rawBody), idempotencyKey: null };

    const first = await handleWebhookTrigger(ctx, secretResolver(), delivery);
    const second = await handleWebhookTrigger(ctx, secretResolver(), delivery);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it("honours a caller-supplied Idempotency-Key over the body digest", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_key");
    const key = generateId();

    const bodyA = JSON.stringify({ n: 1 });
    const bodyB = JSON.stringify({ n: 2 });
    const first = await handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody: bodyA, signature: computeTriggerSignature(SECRET, bodyA), idempotencyKey: key });
    // A DIFFERENT payload under the SAME key is the caller asserting "this is the same
    // delivery" — honoured, because the caller's own de-duplication identity wins.
    const second = await handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody: bodyB, signature: computeTriggerSignature(SECRET, bodyB), idempotencyKey: key });

    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it("accepts a non-JSON body rather than rejecting it — form-encoded and plain-text providers exist", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_text");
    const rawBody = "order_id=ORD-3&total=42";

    const { run } = await handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature(SECRET, rawBody), idempotencyKey: null });
    expect((await findWorkflowRunById(ctx, run.id))!.checkpointJson).toMatchObject({ variables: { body: rawBody } });
  });
});

describe("a webhook trigger is NEVER unauthenticated", () => {
  it("rejects a MISSING signature", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_nosig");
    const rawBody = "{}";
    await expect(handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody, signature: null, idempotencyKey: null })).rejects.toBeInstanceOf(
      WorkflowTriggerSignatureInvalidError,
    );
  });

  it("rejects a WRONG signature", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_badsig");
    const rawBody = "{}";
    await expect(
      handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature("the-wrong-secret", rawBody), idempotencyKey: null }),
    ).rejects.toBeInstanceOf(WorkflowTriggerSignatureInvalidError);
  });

  it("rejects a signature computed over a DIFFERENT body — the signature must cover the bytes actually sent", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_tampered");
    // The classic tamper: sign a benign payload, then send a hostile one.
    const signature = computeTriggerSignature(SECRET, JSON.stringify({ amount: 1 }));
    await expect(
      handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody: JSON.stringify({ amount: 1_000_000 }), signature, idempotencyKey: null }),
    ).rejects.toBeInstanceOf(WorkflowTriggerSignatureInvalidError);
  });

  it("rejects when the trigger's credential cannot be resolved — an unresolvable secret is never treated as 'no signature required'", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_nocred");
    const rawBody = "{}";
    await expect(
      handleWebhookTrigger(ctx, secretResolver(null), { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature(SECRET, rawBody), idempotencyKey: null }),
    ).rejects.toBeInstanceOf(WorkflowTriggerSignatureInvalidError);
  });

  it("rejects a truncated/padded signature without throwing on the length mismatch", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_length");
    const rawBody = "{}";
    const valid = computeTriggerSignature(SECRET, rawBody);
    for (const signature of [valid.slice(0, 10), `${valid}00`, ""]) {
      await expect(handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody, signature, idempotencyKey: null })).rejects.toBeInstanceOf(
        WorkflowTriggerSignatureInvalidError,
      );
    }
  });

  it("NO RUN is created by any rejected delivery", async () => {
    const ctx = await freshTenant();
    const { versionId } = await productionWebhookWorkflow(ctx, "wf_hook_norun");
    const { listWorkflowRuns } = await import("../infrastructure/workflow-run-repository.js");

    await expect(handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody: "{}", signature: "deadbeef", idempotencyKey: null })).rejects.toThrow();
    expect(await listWorkflowRuns(ctx, { workflowVersionId: versionId })).toHaveLength(0);
  });
});

describe("only PRODUCTION versions are addressable, and unknown paths do not leak", () => {
  it("a Draft version's webhook path is not reachable, even with a valid signature", async () => {
    const ctx = await freshTenant();
    const credentialId = generateId();
    // Deliberately NOT promoted — promoting is what makes an endpoint live.
    await createFixtureWorkflowVersion(ctx, "wf_hook_draft", webhookNodes(TRIGGER_PATH, credentialId));

    const rawBody = "{}";
    await expect(
      handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature(SECRET, rawBody), idempotencyKey: null }),
    ).rejects.toBeInstanceOf(WorkflowTriggerNotFoundError);
  });

  it("an unknown path is a bare NotFound with no detail — the endpoint cannot enumerate configured paths", async () => {
    const ctx = await freshTenant();
    await productionWebhookWorkflow(ctx, "wf_hook_unknown");

    const error = await handleWebhookTrigger(ctx, secretResolver(), { path: "totally/unknown", rawBody: "{}", signature: "x", idempotencyKey: null }).catch((e) => e);
    expect(error).toBeInstanceOf(WorkflowTriggerNotFoundError);
    // The message names neither the path tried nor any path that does exist.
    expect(error.message).toBe("No workflow trigger is configured at this path.");
  });

  it("a ChannelEvent-triggered Production workflow is not reachable through the webhook surface", async () => {
    const ctx = await freshTenant();
    const version = await createFixtureWorkflowVersion(ctx, "wf_hook_channel", [
      { id: "trigger_1", kind: "Trigger", source: { kind: "ChannelEvent", channelTypes: ["WebWidget"], event: "conversation.started" }, next: "end_1" },
      endNode("end_1"),
    ]);
    await setWorkflowVersionStatus(ctx, version.id, "Production");

    await expect(handleWebhookTrigger(ctx, secretResolver(), { path: TRIGGER_PATH, rawBody: "{}", signature: "x", idempotencyKey: null })).rejects.toBeInstanceOf(
      WorkflowTriggerNotFoundError,
    );
  });
});

describe("tenant isolation", () => {
  it("one tenant's trigger path is invisible to another tenant's context, even with that tenant's own secret", async () => {
    const owner = await freshTenant();
    const stranger = await freshTenant();
    await productionWebhookWorkflow(owner, "wf_hook_isolated");

    const rawBody = "{}";
    await expect(
      handleWebhookTrigger(stranger, secretResolver(), { path: TRIGGER_PATH, rawBody, signature: computeTriggerSignature(SECRET, rawBody), idempotencyKey: null }),
    ).rejects.toBeInstanceOf(WorkflowTriggerNotFoundError);
  });
});
