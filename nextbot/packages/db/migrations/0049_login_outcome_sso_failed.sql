-- Phase 4 (BL-36, FR-SEC-10): a SAML/OIDC assertion/token that fails validation is a
-- distinct, auditable login_attempt outcome. Kept in its own single-statement
-- migration because Postgres forbids using a freshly-added enum label in the same
-- transaction it was added in (same constraint Model Gateway v2's 0039/0040 split hit).
ALTER TYPE login_outcome ADD VALUE 'SsoFailed';
