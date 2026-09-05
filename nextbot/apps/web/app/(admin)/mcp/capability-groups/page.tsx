import { redirect } from "next/navigation";

/**
 * Blueprint §6.3's route table lists `/mcp/capability-groups`, but Phase 0 (BL-28)
 * already shipped full capability-group CRUD at `/tools/capability-groups` — a new
 * UI over the *existing* `capability_group` schema, not a new table (LLD §14.3.3
 * closes this question explicitly: single-FK model, no bridge table). Rebuilding a
 * second screen over the same table would fork one authority into two UIs for zero
 * capability gain. This route resolves the Blueprint's documented path without
 * duplicating the screen.
 */
export default function McpCapabilityGroupsRedirectPage() {
  redirect("/tools/capability-groups");
}
