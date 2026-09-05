import { callTool, isBreakerOpen, recordBreakerOutcome } from "@nextbot/mcp-client";
import { findConnectorById, getCredentialForDecrypt } from "@nextbot/connectors";
import { findToolById, findCurrentSchemaVersion } from "@nextbot/tool-registry";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { checkToolCallRate } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import type { EgressPort } from "@nextbot/orchestration";
import type { ToolInvocation, ToolResult } from "@nextbot/contracts";

/**
 * Phase 14 (BL-08) — the `EgressPort` implementation the **Admin Console's** Tier-3
 * approval-decision route uses to actually execute an *Approved* tool call.
 *
 * **Flagged architecture deviation (disclosed, not silent):** ADR-0004 frames MCP
 * egress as `apps/gateway`-only ("the Data Plane's Gateway"); this is a second,
 * duplicated `EgressPort` implementation inside `apps/web` (the Control Plane)
 * rather than routing the approved execution through an internal `apps/gateway`
 * endpoint. Building that internal-process handoff (a authenticated internal API +
 * the two-hop request) was out of this dispatch's bounded time; this keeps the
 * Tier-3 "Approve" action genuinely functional today at the cost of a second place
 * this logic lives. Recommended follow-up: consolidate into a shared internal
 * package or have this route call `apps/gateway`'s internal ops surface instead.
 * No PEP re-check gap here relative to gateway's — `decideTier3`'s CAS-claim into
 * `Executing` has already independently verified this is a genuine, single-winner
 * approved decision before this port is ever called; the decision route itself now
 * also re-runs `resolveToolPermission` immediately before dispatch (QA fix BE2, see
 * `apps/web/app/api/v1/admin/approvals/[id]/decision/route.ts`).
 *
 * **QA fix (BE2, significant):** this port previously had no circuit-breaker check at
 * all, unlike `apps/gateway`'s egress. It now shares `@nextbot/mcp-client`'s
 * `isBreakerOpen`/`recordBreakerOutcome` — the exact same breaker-state module
 * `apps/gateway`'s `mcp-egress.ts` uses, extracted there specifically so this path
 * would not grow a second, parallel breaker implementation.
 */
export function createAdminMcpEgressPort(ctx: TenantContext): EgressPort {
  let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
  return {
    async invokeTool(invocation: ToolInvocation): Promise<ToolResult> {
      if (await isBreakerOpen(ctx.tenantId, invocation.toolId)) {
        return { outcome: "Denied", reason: "circuit_open" };
      }

      // Phase 18 (BL-11, NFR-4a) — same live tool-calls/sec quota check as the
      // customer-facing egress path (`apps/gateway`'s `mcp-egress.ts`).
      await checkToolCallRate(ctx);

      const tool = await findToolById(ctx, invocation.toolId);
      const connector = await findConnectorById(ctx, invocation.connectorId);
      if (!tool || !connector) {
        return { outcome: "Failed", errorMessage: "tool or connector no longer exists" };
      }
      const schemaVersion = await findCurrentSchemaVersion(ctx, invocation.toolId);
      if (!schemaVersion) {
        return { outcome: "Failed", errorMessage: "tool has no discovered schema" };
      }

      const headers: Record<string, string> = {};
      if (connector.credentialId) {
        const encrypted = await getCredentialForDecrypt(ctx, connector.credentialId);
        if (encrypted) {
          if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
          const plaintext = await secretsProvider.get(encrypted.ciphertext, encrypted.dekRef, {
            tenantId: ctx.tenantId,
            kind: "connector-credential",
            id: connector.credentialId,
          });
          headers.authorization = `Bearer ${plaintext}`;
        }
      }

      try {
        const output = await callTool(
          invocation.toolName,
          invocation.args,
          { inputSchema: schemaVersion.inputSchema, outputSchema: schemaVersion.outputSchema },
          { endpointUrl: connector.endpointUrl ?? "", headers },
        );
        await recordBreakerOutcome(ctx.tenantId, invocation.toolId, true);
        return { outcome: "Succeeded", output };
      } catch (err) {
        await recordBreakerOutcome(ctx.tenantId, invocation.toolId, false);
        // Security review: never log unmasked args/credentials — only the error
        // message crosses this boundary.
        return { outcome: "Failed", errorMessage: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
