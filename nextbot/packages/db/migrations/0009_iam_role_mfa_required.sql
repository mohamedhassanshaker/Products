-- QA-driven fix pass (Defect B3, FR-SEC-03 / ADR-0002 §4.2): per-role "MFA required"
-- flag. A user assigned a role with this flag set must complete MFA enrollment
-- before/immediately upon first login, rather than MFA being purely voluntary
-- opt-in forever (see packages/modules/iam/src/application/authenticate-user.ts).
-- Defaults to false so every existing seeded/custom role is unaffected until a
-- tenant explicitly opts a role in.

ALTER TABLE role ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
