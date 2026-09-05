-- Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.6 M6, part 1 of 2) — renames
-- `model_call_status` to `model_usage_outcome` and adds the two new outcomes Route v2
-- can now record (`CacheHit` — a cache hit never actually calls a provider;
-- `BudgetStopped` — a call blocked before it could even attempt one). Split into its
-- own migration file/transaction, matching this codebase's established convention
-- (0039/0040) for `ALTER TYPE ... ADD VALUE`, even though this specific migration
-- never references the new values itself.

ALTER TYPE model_call_status RENAME TO model_usage_outcome;
ALTER TYPE model_usage_outcome ADD VALUE 'CacheHit';
ALTER TYPE model_usage_outcome ADD VALUE 'BudgetStopped';
