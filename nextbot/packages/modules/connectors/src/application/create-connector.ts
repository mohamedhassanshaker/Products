import { ConnectorNameDuplicateError, CredentialRequiredError, type CreateConnectorRequest } from "@nextbot/contracts";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import type { TenantContext } from "@nextbot/db";
import { findConnectorByName, findConnectorById, insertConnector, type ConnectorRow } from "../infrastructure/connector-repository.js";
import { insertCredential } from "../infrastructure/credential-repository.js";

let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

/**
 * Registers an MCP connector (BL-02). If `authMethod != "None"`, the supplied
 * `credentialPlaintext` is envelope-encrypted (ADR-0007) and stored as a `credential`
 * row before the connector row references it — the plaintext itself is never
 * persisted and never returned.
 *
 * @throws {ConnectorNameDuplicateError} `(tenant, environment, name)` collision.
 * @throws {CredentialRequiredError} `authMethod != "None"` but no credential supplied.
 */
export async function createConnector(ctx: TenantContext, input: CreateConnectorRequest): Promise<ConnectorRow> {
  const existing = await findConnectorByName(ctx, input.environment, input.name);
  if (existing) throw new ConnectorNameDuplicateError(input.name);

  let credentialId: string | null = null;
  if (input.authMethod !== "None") {
    if (!input.credentialPlaintext) throw new CredentialRequiredError();

    // Same id is used both as the `credential` row's PK and as the envelope
    // encryption's AAD context id — they must match, or decryption in
    // `discover-tools.ts` fails GCM auth-tag verification.
    const rowId = crypto.randomUUID();
    const encrypted = await getProvider().put(input.credentialPlaintext, {
      tenantId: ctx.tenantId,
      kind: "connector-credential",
      id: rowId,
    });
    credentialId = await insertCredential(ctx, {
      id: rowId,
      label: input.credentialLabel ?? `${input.name} credential`,
      type: authMethodToCredentialType(input.authMethod),
      vaultRef: encrypted.vaultRef,
      ciphertext: encrypted.ciphertext,
      dekRef: encrypted.dekRef,
      maskedHint: encrypted.maskedHint,
    });
  }

  const connectorId = await insertConnector(ctx, {
    name: input.name,
    description: input.description,
    backendType: input.backendType,
    templateKey: input.templateKey,
    transport: input.transport,
    endpointUrl: input.endpointUrl,
    authMethod: input.authMethod,
    credentialId,
    environment: input.environment,
  });

  // A newly-created connector starts at the DB-default `Offline` status and is
  // picked up by the scheduled health-check worker on its next run (every 60s by
  // default, `health_interval_seconds`) — the health subsystem (`health-check.ts`)
  // is the only writer of `connector.status` (FR-MCP-01), so we deliberately don't
  // probe synchronously here: that would put a real outbound network call (up to
  // `DEFAULT_TIMEOUT_MS` = 15s) on the connector-creation request path, which is a
  // materially worse experience than a bounded ≤60s wait for status to settle.
  return (await findConnectorById(ctx, connectorId)) as ConnectorRow;
}

function authMethodToCredentialType(authMethod: CreateConnectorRequest["authMethod"]): "APIKey" | "OAuthToken" | "BearerToken" {
  switch (authMethod) {
    case "OAuth2":
      return "OAuthToken";
    case "BearerToken":
      return "BearerToken";
    default:
      return "APIKey";
  }
}
