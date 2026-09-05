-- Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel customer
-- identity resolution: a tenant-opt-in (default OFF) toggle that, when explicitly
-- enabled, lets conversations across different channels sharing an EXACT
-- `customer_identifier_hash` be treated as the same underlying customer for context
-- continuity. Never an automatic/inferred merge (FR-OC-08's own hard requirement) —
-- this table only records whether the tenant has opted in; the matching itself is
-- always an exact-hash equality check, computed in application code
-- (`packages/modules/conversations/src/domain/customer-identifier-hash.ts`).
--
-- Kept as its own dedicated table (not folded into `tenant_data_policy`, which is
-- retention/residency-scoped per its own doc comment) so the opt-in's audit trail and
-- intent are unambiguous.

CREATE TABLE tenant_identity_resolution_policy (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
