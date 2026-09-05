// PUBLIC API for the "pii" module. The ONLY file other packages may import from
// (LLD §2.2). Phase 17 (BL-10): PII detection/masking, guardrail authoring, DSR
// request record-keeping.

// domain
export {
  detectPii,
  maskText,
  detectAndMask,
  maskJsonValue,
  type PiiEntityType,
  type PiiContext,
  type ConnectorTrustLevel,
  type PiiMaskAction,
  type CustomPiiRule,
  type DetectedEntity,
  type PolicyLookup,
} from "./domain/masker.js";

// application — guardrail authoring (supersedes Phase 12's stub array)
export {
  listEnabledGuardrailRules,
  listGuardrailRules,
  createGuardrailRule,
  updateGuardrailRule,
  deleteGuardrailRule,
  type GuardrailRuleRow,
  type UpsertGuardrailRuleInput,
} from "./application/guardrail-rules.js";

// application — PII rule/policy authoring
export {
  listPiiRules,
  createPiiRule,
  updatePiiRule,
  deletePiiRule,
  listCustomPiiRulesForMasking,
  listPiiPolicies,
  setPiiPolicy,
  buildPolicyLookup,
  type PiiRuleRow,
  type CreatePiiRuleInput,
  type PiiPolicyRow,
} from "./application/pii-policy.js";

// application — DSR request record-keeping
export {
  createDsrRequest,
  completeDsrRequest,
  listDsrRequests,
  type DsrRequestRow,
  type DsrType,
  type DsrStatus,
} from "./application/dsr-requests.js";
