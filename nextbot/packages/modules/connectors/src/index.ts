// PUBLIC API for @nextbot/connectors (LLD §2.2, BL-02).
export { createConnector } from "./application/create-connector.js";
export { discoverTools } from "./application/discover-tools.js";
export {
  listConnectors,
  findConnectorById,
  findConnectorByName,
  insertConnector,
  type ConnectorRow,
} from "./infrastructure/connector-repository.js";
export {
  getCredentialMasked,
  getCredentialForDecrypt,
  insertCredential,
  type CredentialMaskedRow,
} from "./infrastructure/credential-repository.js";
export {
  handleListConnectors,
  handleGetConnector,
  handleCreateConnector,
  handleDiscoverTools,
} from "./http/admin-routes.js";
export {
  probeConnectorHealth,
  probeAllConnectorsForTenant,
  probeAllConnectorsAcrossAllTenants,
  getConnectorHealthSummary,
  type HealthProbeResult,
  type ConnectorHealthSummary,
} from "./application/health-check.js";
export {
  listAlertRulesForConnector,
  createAlertRule,
  evaluateAlertsForConnector,
  type ConnectorAlertRuleRow,
  type CreateAlertRuleInput,
  type AlertMetric,
  type AlertDestinationKind,
} from "./application/alert-rules.js";
