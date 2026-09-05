-- Phase 4 retry (QA 20260829-054900 Finding 1): distinguishes a role grant an admin
-- (or SCIM provisioning) made deliberately ('Manual') from one SSO login itself
-- derived from the IdP's current group assertion ('Sso'). Only 'Sso'-sourced rows
-- are ever removed by SSO login's re-derivation (application/sso-login.ts's
-- syncSsoRoleAssignment) — see packages/modules/iam/README.md's Phase 4 decision
-- log for the full rationale. Defaults every existing/new row to 'Manual' so no
-- pre-existing grant (including every row inserted before this migration) is ever
-- mistaken for an SSO-derived one and swept up by the new re-derivation logic.

CREATE TYPE user_role_source AS ENUM ('Manual', 'Sso');

ALTER TABLE user_role ADD COLUMN source user_role_source NOT NULL DEFAULT 'Manual';
