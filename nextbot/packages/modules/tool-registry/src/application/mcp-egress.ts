import { callTool, isBreakerOpen, recordBreakerOutcome } from "@nextbot/mcp-client";
import { findConnectorById, getCredentialForDecrypt } from "@nextbot/connectors";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { checkToolCallRate } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import type { ToolInvocation, ToolResult } from "@nextbot/contracts";
import { findToolById, findCurrentSchemaVersion } from "../infrastructure/tool-repository.js";
import { resolveToolPermission } from "./permission-service.js";

/**
 * **The one MCP egress implementation in this codebase** (ADR-0004, LLD §2.3).
 *
 * `orchestration`'s `ports/egress.ts` declares the `EgressPort` interface; this is its
 * only production implementation, and every composition root that needs to dispatch a
 * tool call constructs it from here.
 *
 * ---
 *
 * **Why this file moved here in Target Architecture Blueprint Phase 16 (BL-47b).**
 *
 * It previously lived at `apps/gateway/src/lib/mcp-egress.ts`, because until now the
 * gateway was the only composition root that dispatched tool calls. Phase 16's workflow
 * executor is hosted by `apps/worker` (ADR-0013 §7), and a `ToolCall` node dispatches
 * through the same `EgressPort` the approval path uses (ADR-0013 §7.2 constraint 2) — so
 * a second composition root now needs it.
 *
 * `eslint.config.mjs`'s boundaries forbid both alternatives to moving it: an app may not
 * import another app (`{ from: "app", allow: ["module", "shared"] }`), and a shared
 * package may not import a bounded module (`{ from: "shared", allow: ["shared"] }`,
 * while this needs `connectors` and `tenancy`). A bounded module is therefore the only
 * legal home, and `tool-registry` is the right one: it already owns the tool catalog,
 * the schema versions and `resolveToolPermission` — the three things the PEP re-check
 * below reads — and its allow-list already contains `connectors` and `tenancy`.
 * `@nextbot/mcp-client` and `@nextbot/secrets` are shared packages any module may import.
 *
 * The alternative — copying it into `apps/worker` — is exactly the "second, un-reviewed
 * implementation" this codebase's own QA fix BE2 comment warned against when it
 * extracted the circuit breaker into `mcp-client` for the same reason. **The behaviour
 * is byte-identical to the version that shipped in `apps/gateway`**;
 * `apps/gateway/src/lib/mcp-egress.ts` is now a thin re-export, so every existing
 * gateway test (`mcp-egress.int.test.ts`, `orchestration-approval-service.int.test.ts`,
 * the turn-pipeline suites) continues to exercise this exact code through its original
 * import path.
 *
 * **Disclosed observation on ADR-0004.** That ADR's narrative says `mcp-client` and
 * credential decryption run "only inside the gateway process". That has not been
 * literally true for some time and is not made untrue by this move: `apps/worker`
 * already opens MCP connections today via `mcp.health-check`
 * (`@nextbot/connectors` -> `mcp-client`) and `mcp.manifest-reconcile`
 * (`@nextbot/mcp-registry` -> `mcp-client`), both shipped and QA-approved. This change
 * adds a *fourth* caller in a process that already had two, and it does not widen what
 * any process can reach. Logged for the orchestrator as doc debt on ADR-0004's wording,
 * not treated as a silent architectural change.
 *
 * ---
 *
 * The three security properties, unchanged from the original file's own security review:
 *
 * 1. **PEP re-check** (defense in depth, FR-SEC-06): `resolveToolPermission` is re-run
 *    here even though the caller's tier engine already filtered by policy moments
 *    earlier — a second, independent enforcement point right before the network call
 *    leaves the process.
 * 2. **Credential injection** via the Phase 4 vault (`KmsEnvelopeSecretsProvider`) —
 *    plaintext credentials never cross the `EgressPort` boundary or get logged; they
 *    exist only inside this function's stack frame for the duration of the call.
 * 3. **Circuit breaker** — `@nextbot/mcp-client`'s shared `isBreakerOpen`/
 *    `recordBreakerOutcome`, plus `tenant_runtime_quota.max_tool_calls_per_second`
 *    (NFR-4a) enforced at the same choke point.
 */

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

/** Structurally identical to `orchestration`'s `EgressPort`. Declared here rather than
 *  imported so `tool-registry` does not need an `orchestration` edge for a one-method
 *  interface — the two are checked against each other at every call site that passes
 *  this into `runTurnPipeline`/`decideTier3`/the workflow node runtime. */
export interface McpEgressPort {
  invokeTool(invocation: ToolInvocation): Promise<ToolResult>;
}

export function createMcpEgressPort(ctx: TenantContext): McpEgressPort {
  return {
    async invokeTool(invocation: ToolInvocation): Promise<ToolResult> {
      if (await isBreakerOpen(ctx.tenantId, invocation.toolId)) {
        return { outcome: "Denied", reason: "circuit_open" };
      }

      // Phase 18 (BL-11, NFR-4a): a real `tenant_runtime_quota.max_tool_calls_per_second`
      // ceiling, enforced at the same choke point the breaker uses — thrown as
      // `QuotaExceededError`, which `problemResponse` maps to a distinct response
      // rather than a generic failure.
      await checkToolCallRate(ctx);

      // 1. PEP re-check (defense in depth, FR-SEC-06). This only re-verifies the
      // policy `effect` (rule deny / circuit open / connector offline) — it does
      // NOT re-reject on `tier`. Egress is reached in exactly two cases: (a) a
      // Tier-1 call, which never suspended, or (b) a Tier-2/3 call whose approval
      // gate (`approval-service.ts`'s CAS-claim into `Executing`) has *already*
      // recorded a real customer-confirm/human-approve decision — re-denying here
      // because `tier !== "Tier1"` would incorrectly block every approved Tier-2/3
      // call from ever actually executing (Phase 14/BL-08).
      const resolution = await resolveToolPermission(ctx, invocation.toolId, {});
      if (resolution.effect === "Deny") {
        return { outcome: "Denied", reason: resolution.reason };
      }

      const tool = await findToolById(ctx, invocation.toolId);
      const connector = await findConnectorById(ctx, invocation.connectorId);
      if (!tool || !connector) {
        return { outcome: "Failed", errorMessage: "tool or connector no longer exists" };
      }

      const schemaVersion = await findCurrentSchemaVersion(ctx, invocation.toolId);
      if (!schemaVersion) {
        return { outcome: "Failed", errorMessage: "tool has no discovered schema" };
      }

      // 2. Credential injection via the Phase 4 vault.
      const headers: Record<string, string> = {};
      if (connector.credentialId) {
        const encrypted = await getCredentialForDecrypt(ctx, connector.credentialId);
        if (encrypted) {
          const plaintext = await getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, {
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
        // Security review: never log unmasked args/credentials here — only the error
        // message (already scrubbed of headers by mcp-client's transport layer) and
        // identifiers cross into the ToolResult/domain_event boundary.
        return { outcome: "Failed", errorMessage: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
