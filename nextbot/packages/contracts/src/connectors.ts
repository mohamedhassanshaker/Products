import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { EnvironmentSchema } from "./common.js";

export const BackendType = Type.Union([
  Type.Literal("Ticketing"),
  Type.Literal("CRM"),
  Type.Literal("ERP"),
  Type.Literal("Billing"),
  Type.Literal("HRIS"),
  Type.Literal("KnowledgeBase"),
  Type.Literal("Custom"),
]);
export type BackendTypeValue = Static<typeof BackendType>;

export const McpTransport = Type.Union([Type.Literal("StreamableHTTP"), Type.Literal("StdioViaGateway")]);
export type McpTransportValue = Static<typeof McpTransport>;

export const ConnectorAuthMethod = Type.Union([
  Type.Literal("OAuth2"),
  Type.Literal("APIKey"),
  Type.Literal("BearerToken"),
  Type.Literal("CustomHeader"),
  Type.Literal("mTLS"),
  Type.Literal("None"),
]);
export type ConnectorAuthMethodValue = Static<typeof ConnectorAuthMethod>;

export const CredentialType = Type.Union([
  Type.Literal("APIKey"),
  Type.Literal("OAuthToken"),
  Type.Literal("SystemUserToken"),
  Type.Literal("BearerToken"),
  Type.Literal("ClientCertificate"),
  Type.Literal("MfaSecret"),
  Type.Literal("ModelProviderKey"),
  // Phase 10 (BL-07, ADR-0009): the tenant's Git OAuth token and webhook HMAC secret —
  // stored via this same vault, never a bespoke storage path.
  Type.Literal("GitOAuthToken"),
  Type.Literal("WebhookSecret"),
  // Phase 3 (BL-15): Meta App Secret + webhook verify token, vaulted like every
  // other credential (see `packages/db/src/schema/connectors.ts`'s matching enum
  // doc comment for the full rationale).
  Type.Literal("MetaAppSecret"),
  Type.Literal("MetaWebhookVerifyToken"),
]);
export type CredentialTypeValue = Static<typeof CredentialType>;

export const ConnectorStatus = Type.Union([
  Type.Literal("Connected"),
  Type.Literal("Degraded"),
  Type.Literal("Offline"),
]);
export type ConnectorStatusValue = Static<typeof ConnectorStatus>;

export const CreateConnectorRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  backendType: BackendType,
  templateKey: Type.Optional(Type.String()),
  transport: McpTransport,
  endpointUrl: Type.Optional(Type.String({ format: "uri", pattern: "^https://" })),
  authMethod: ConnectorAuthMethod,
  environment: EnvironmentSchema,
  // Present only when authMethod != "None" — the raw secret material, hashed/vaulted
  // by the application service and never persisted as given.
  credentialPlaintext: Type.Optional(Type.String({ minLength: 1 })),
  credentialLabel: Type.Optional(Type.String()),
});
export type CreateConnectorRequest = Static<typeof CreateConnectorRequestSchema>;

export class ConnectorNameDuplicateError extends DomainError {
  readonly code = "CONNECTOR_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A connector named '${name}' already exists in this environment.`);
  }
}

export class ConnectorNotFoundError extends DomainError {
  readonly code = "CONNECTOR_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Connector '${id}' was not found.`);
  }
}

/** FR-MCP-02: transport errors during discovery are surfaced verbatim, never wrapped
 * behind a generic message — this error type carries the raw detail through. */
export class DiscoveryTransportError extends DomainError {
  readonly code = "DISCOVERY_TRANSPORT_ERROR";
  readonly httpStatus = 502;
  constructor(readonly detail: string) {
    super(detail);
  }
}

export class CredentialRequiredError extends DomainError {
  readonly code = "CREDENTIAL_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super("A credential is required for this authentication method.");
  }
}

export class ConnectorEndpointInvalidError extends DomainError {
  readonly code = "CONNECTOR_ENDPOINT_INVALID";
  readonly httpStatus = 422;
  constructor(reason: string) {
    super(`Invalid connector endpoint: ${reason}`);
  }
}
