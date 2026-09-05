-- Target Architecture Blueprint Phase 2 (BL-33, ADR-0011, LLD §14.8.6 M4, part 1 of 2)
-- — new enums for Route v2, split into their own migration file/transaction so the
-- table-alteration migration that follows (0044) can safely reference them.

CREATE TYPE model_route_version_status AS ENUM ('Draft', 'Published', 'Deprecated');

-- FR-AGT-23's recommended per-role standard route names — a recommendation, not a
-- constraint (any `model_route.name` is legal; `role` is metadata only).
CREATE TYPE model_route_role AS ENUM (
  'chat.primary', 'chat.router', 'embed.default', 'rerank.default', 'vision.default', 'custom'
);

CREATE TYPE model_route_status AS ENUM ('Active', 'Archived');
