# ADR-0007 — Credential vault via KMS envelope encryption with per-tenant DEKs

**Status:** Accepted · 2026-08-15
**Context refs:** FR-SEC-02, FR-MCP-01, FR-AGT-07, FR-A2A-05, NFR-4, NFR-5, NFR-6, data model `Credential`

## 1. Context

NextBot holds high-value third-party secrets on behalf of tenants: MCP connector credentials
(OAuth2 tokens, API keys, bearer tokens, custom headers, mTLS client certs), channel credentials
(Meta System User tokens, telephony keys, SMTP/IMAP), model-provider keys, A2A counterpart
credentials, and Gateway Agent credentials. FR-SEC-02 requires: encrypted at rest, masked in every
UI, rotatable and revocable, and **never plaintext-readable from the console after initial entry**.
The spec's data model already forbids a plaintext column — `Credential` stores only a `vault_ref`.

## 2. Decision

**Envelope encryption against a regional cloud KMS, with one data encryption key (DEK) per tenant,
and ciphertext stored in a dedicated `vault` schema readable only by the Gateway Plane's database
role.**

- **KEK**: a per-region customer-managed key in the cell's KMS (AWS KMS / Azure Key Vault / GCP KMS
  depending on where the cell runs). Never leaves the KMS. Rotation is a KMS operation.
- **DEK**: one AES-256 key per tenant, generated on tenant provisioning, stored only in
  KMS-wrapped form. Blast radius of a leaked DEK is one tenant — this is the NFR-4 credential-layer
  guarantee that RLS alone cannot give.
- **Ciphertext**: AES-256-GCM, with the tenant id, credential id, and credential type bound as
  **additional authenticated data**, so a ciphertext blob cannot be relocated to another tenant's or
  another connector's row and still decrypt. Stored in `vault.credential_secret`, keyed by the
  `Credential.vault_ref` the application schema already models.
- **Access**: `GRANT SELECT` on the `vault` schema is given to the gateway role only. The web and
  runtime roles have no grant at all — verified by the ADR-0001 §6 test suite. Decryption happens
  in-process in the Gateway Plane, in memory, for the duration of one outbound call; plaintext is
  never written to a log, a trace attribute, an error message, an audit `detail` payload, or a
  database column.
- **Write path**: credentials are submitted through a dedicated Control Plane endpoint that forwards
  to the Gateway Plane for encryption and never persists the plaintext itself. The Control Plane
  reads back only metadata: type, last four characters, `last_rotated_at`, `expires_at`, status.
- **Rotation / revocation**: a new version row is written and the old is marked superseded, so an
  in-flight call using the previous version completes rather than failing mid-request. Revocation is
  immediate for new calls (FR-A2A-05's "fail-closed on new work, not abrupt mid-task failure"
  pattern, applied uniformly to all credential types). Expiry within a configurable window raises the
  same alerting channel as connector health (FR-MCP-08) and flips a connector to `Offline` on actual
  expiry (FR-MCP-01).

## 3. Alternatives considered

**HashiCorp Vault.** Rejected. It is the strongest option technically, but it moved to BUSL in 2023 —
a commercial-licensing question this project has not budgeted — and it adds a stateful HA component
to *every* regional cell, multiplying operational cost by region count. Its main advantage over the
chosen design (dynamic secrets, leasing) is not something NextBot's third-party-credential use case
can exploit, because tenant backend credentials are static and tenant-issued.

**OpenBao** (MPL fork of Vault). Rejected for MVP on operational cost, not licensing. It remains the
cleanest migration target if per-secret access policies, leasing, or a formal secrets audit trail
beyond our own audit log later become requirements; the `vault_ref` indirection in the data model
means that migration touches one module.

**Cloud secrets manager (AWS Secrets Manager / Azure Key Vault secrets) with one secret per
credential.** Rejected: per-secret cost and API rate limits scale badly at tenants × connectors ×
channels, and per-tenant key isolation is awkward. KMS is used for key management, which is what it
is priced and rate-limited for; the ciphertext lives in our own database, which is cheap.

**Application-level encryption with a single platform-wide key in an env var.** Rejected: one leaked
key compromises every tenant's backend systems, and it fails NFR-4's credential dimension outright.

## 4. Consequences

- KMS is on the critical path for the first tool call after a cache miss. Mitigation: the unwrapped
  DEK is cached in the gateway process memory with a short TTL (minutes) and is never persisted; a
  KMS outage degrades to failing new decrypts, not to plaintext fallback.
- Per-region KMS keys make residency (NFR-6) hold at the key layer too: a cell physically cannot
  decrypt another region's ciphertext.
- Region migration of a tenant requires re-wrapping under the destination region's KEK — a
  known-and-scoped step of the assisted migration NFR-6 already defers out of MVP automation.
- The LLD should specify `vault.credential_secret` (versioned rows, AAD composition, supersede
  semantics) and the exact grants, since the grants are the security control.
- QA check: a grep gate asserting no code path logs a decrypted secret, plus a test that the web and
  runtime roles receive a permission error on the `vault` schema.
