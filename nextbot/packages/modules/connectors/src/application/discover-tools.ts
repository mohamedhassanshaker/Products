import { ConnectorNotFoundError } from "@nextbot/contracts";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { listTools, type McpToolDescriptor } from "@nextbot/mcp-client";
import type { TenantContext } from "@nextbot/db";
import { findConnectorById, markDiscovered } from "../infrastructure/connector-repository.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";

let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

/**
 * FR-MCP-01/02: connects to the connector's MCP server and lists its tools.
 *
 * Credential decryption uses `getCredentialForDecrypt`, which reads via the
 * "gateway" DB role (`withGatewayTenant`) — the only role DB-grant-permitted to
 * SELECT `credential.ciphertext` (LLD §3.5). Everything else in this function uses
 * the ordinary tenant-scoped ("app") role.
 *
 * Scoped simplification for this dispatch (documented, not silently decided): the
 * full ADR-0004 process split — `apps/runtime` reaching `apps/gateway` only through
 * an internal RPC `ports/egress.ts` port, with `mcp-client` executing exclusively
 * inside the physically separate `apps/gateway` process — is deferred. This service
 * is callable from `apps/web`'s admin route today; the DB-level security boundary
 * (gateway-role-only ciphertext SELECT) is real and enforced regardless of which
 * process calls it, but the *process* separation itself is deferred to the phase
 * that structurally needs it (Phase 12's Tier-1 tool-call egress path), consistent
 * with how physical Enterprise DB provisioning was deferred to nexus-deploy in
 * Phase 1. Flagged in `docs/plans/nextbot-plan.md` rather than silently declared
 * fully ADR-0004-compliant.
 *
 * @throws {ConnectorNotFoundError} unknown connector id for this tenant.
 * @throws {McpTransportError} (from `@nextbot/mcp-client`) surfaced verbatim on any
 *   transport/protocol failure (FR-MCP-02).
 */
export async function discoverTools(ctx: TenantContext, connectorId: string): Promise<McpToolDescriptor[]> {
  const connector = await findConnectorById(ctx, connectorId);
  if (!connector) throw new ConnectorNotFoundError(connectorId);

  const headers: Record<string, string> = {};
  if (connector.credentialId) {
    const encrypted = await getCredentialForDecrypt(ctx, connector.credentialId);
    if (encrypted) {
      const plaintext = await getProvider().get(encrypted.ciphertext, encrypted.dekRef, {
        tenantId: ctx.tenantId,
        kind: "connector-credential",
        id: connector.credentialId,
      });
      headers.authorization = `Bearer ${plaintext}`;
    }
  }

  const tools = await listTools({ endpointUrl: connector.endpointUrl ?? "", headers });
  await markDiscovered(ctx, connectorId);
  return tools;
}
