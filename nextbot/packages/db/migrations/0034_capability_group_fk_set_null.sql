-- Phase 6 (BL-28, FR-MCP-17, LLD §14.3.3) — capability-group management screen.
-- No new table (management is new UI over the existing `capability_group` table).
-- The only schema touch: `tool.capability_group_id`'s FK becomes `ON DELETE SET NULL`
-- so "delete a group -> its tools become Ungrouped" is engine-enforced as a backstop,
-- even though the actual application-level deletion path
-- (`deleteCapabilityGroup`, tool-registry) already performs this reassignment
-- explicitly in the same transaction and never hard-deletes a `capability_group` row
-- (deletion there is `deleted_at`, matching this table's existing soft-delete
-- convention). Purely additive to the constraint's delete action — no data changes.

ALTER TABLE tool DROP CONSTRAINT tool_capability_group_id_fkey;
ALTER TABLE tool
  ADD CONSTRAINT tool_capability_group_id_fkey
  FOREIGN KEY (capability_group_id) REFERENCES capability_group (id) ON DELETE SET NULL;
