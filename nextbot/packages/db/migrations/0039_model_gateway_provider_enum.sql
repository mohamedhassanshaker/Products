-- Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8.6 M1, part 1 of 2)
-- — the enum rename/extension, split into its OWN migration file/transaction.
--
-- Postgres forbids using a newly `ADD VALUE`d enum label within the SAME transaction
-- it was added in ("unsafe use of new value ... New enum values must be committed
-- before they can be used"). The SQL migration runner (`run-sql-migrations.ts`) wraps
-- each *file* in its own transaction, so the table-alteration migration that actually
-- USES 'ollama'/'custom'/etc. (in a CHECK constraint) must be a later, separate file —
-- see `0040_model_gateway_provider_table.sql`.

ALTER TYPE model_provider_key RENAME TO model_provider_type;
ALTER TYPE model_provider_type ADD VALUE 'google-vertex';
ALTER TYPE model_provider_type ADD VALUE 'bedrock';
ALTER TYPE model_provider_type ADD VALUE 'openrouter';
ALTER TYPE model_provider_type ADD VALUE 'ollama';
ALTER TYPE model_provider_type ADD VALUE 'cohere';
ALTER TYPE model_provider_type ADD VALUE 'mistral';
ALTER TYPE model_provider_type ADD VALUE 'custom';

CREATE TYPE model_provider_status AS ENUM ('Active', 'Unreachable', 'Disabled', 'CredentialInvalid');
CREATE TYPE model_auth_method AS ENUM ('ApiKey', 'EntraId', 'ServiceAccount', 'IamRole', 'Mtls', 'None');
