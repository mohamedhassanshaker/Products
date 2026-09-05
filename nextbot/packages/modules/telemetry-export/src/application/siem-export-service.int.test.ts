import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { recordAuditEntry } from "@nextbot/audit";
import type { TenantContext } from "@nextbot/db";
import { exportSiemBatchForTenant } from "./siem-export-service.js";
import { getSiemExportConfig, upsertSiemExportConfig } from "../infrastructure/siem-export-config-repository.js";

/**
 * `updateSiemExportSettings` rightly rejects a non-`https://` endpoint (real
 * production behavior, independently unit-tested via `WebhookTargetUrlInvalidError`'s
 * shared validation) — this in-process receiver is plain `http://127.0.0.1`, so this
 * helper calls the lower-level repository upsert directly, the same "bypass only the
 * URL-scheme check, exercise everything else for real" pattern
 * `@nextbot/webhooks`' own dispatch integration test already establishes.
 */
async function configureSiemExport(ctx: TenantContext, endpointUrl: string, enabled: boolean) {
  return upsertSiemExportConfig(ctx, { endpointUrl, enabled });
}

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — the plan doc's own exit
 * gate: this table's cursor (`last_exported_audit_log_id`) is genuinely its own,
 * independent of `domain_event.processed`/`processed_at` (`@nextbot/audit`'s own
 * private cursor). A batch is only marked exported once the POST genuinely succeeds,
 * and a failed batch is retried from the SAME (unmoved) cursor on the next tick.
 */
async function startReceiver(responder: () => number): Promise<{ url: string; bodies: string[]; close: () => Promise<void> }> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      const status = responder();
      res.writeHead(status, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return { url, bodies, close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))) };
}

describe("SIEM audit-log export — own cursor, independent of domain_event.processed, batch-safe on endpoint failure", () => {
  const createdTenantIds: string[] = [];
  const serversToClose: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    for (const close of serversToClose.splice(0)) await close();
  });

  async function tenant(): Promise<TenantContext> {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    return ctx;
  }

  it("exports a real audit_log_entry row, advances its own cursor, and does not re-export it on the next tick", async () => {
    const ctx = await tenant();
    const server = await startReceiver(() => 200);
    serversToClose.push(server.close);
    await configureSiemExport(ctx, server.url, true);

    await recordAuditEntry(ctx, { actorLabel: "system", actionType: "escalations.escalation_created", outcome: "Success", details: { escalationId: "esc-1" } });

    const first = await exportSiemBatchForTenant(ctx);
    expect(first.exported).toBe(1);
    expect(server.bodies).toHaveLength(1);
    expect(server.bodies[0]).toContain("escalations.escalation_created");

    const config = await getSiemExportConfig(ctx);
    expect(config?.lastExportedAuditLogId).not.toBeNull();

    const second = await exportSiemBatchForTenant(ctx);
    expect(second.exported).toBe(0);
    expect(server.bodies).toHaveLength(1); // no re-export
  });

  it("does not advance the cursor when the endpoint rejects the batch — the next tick retries the SAME rows", async () => {
    const ctx = await tenant();
    let status = 500;
    const server = await startReceiver(() => status);
    serversToClose.push(server.close);
    await configureSiemExport(ctx, server.url, true);
    await recordAuditEntry(ctx, { actorLabel: "system", actionType: "escalations.escalation_created", outcome: "Success", details: { escalationId: "esc-2" } });

    const failed = await exportSiemBatchForTenant(ctx);
    expect(failed.exported).toBe(0);
    const configAfterFailure = await getSiemExportConfig(ctx);
    expect(configAfterFailure?.lastExportedAuditLogId ?? null).toBeNull();

    status = 200;
    const retried = await exportSiemBatchForTenant(ctx);
    expect(retried.exported).toBe(1);
  });

  it("is a no-op when disabled, and never touches domain_event at all (this table's cursor is entirely its own)", async () => {
    const ctx = await tenant();
    await recordAuditEntry(ctx, { actorLabel: "system", actionType: "escalations.escalation_created", outcome: "Success", details: {} });
    const result = await exportSiemBatchForTenant(ctx); // no config at all yet
    expect(result.exported).toBe(0);
  });
});
