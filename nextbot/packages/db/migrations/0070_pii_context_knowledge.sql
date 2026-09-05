-- Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08): the PII masking-context
-- matrix now also governs knowledge_chunk.text — index-time masking (per the
-- collection's own trust level) and read-time re-evaluation (per the requesting
-- agent's own trust level) both resolve against (entityType, 'Knowledge', trustLevel).
-- Kept in its own single-statement migration because Postgres forbids using a
-- freshly-added enum label in the same transaction it was added in (same constraint
-- Model Gateway v2's 0039/0040 split and the SSO login_outcome 0049 addition hit).
ALTER TYPE pii_context ADD VALUE 'Knowledge';
