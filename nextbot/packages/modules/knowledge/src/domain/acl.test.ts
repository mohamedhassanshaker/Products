import { describe, expect, it } from "vitest";
import { deriveAclTags, unionAclTags } from "./acl.js";

describe("deriveAclTags (ADR-0018 §2.4 — opaque hashes only, never a readable name)", () => {
  it("produces the same tags for the same acl input (deterministic)", () => {
    const acl = { roleIds: ["r1"], capabilityGroupIds: ["cg1"], tags: ["public"], visibility: "Tenant" as const };
    expect(deriveAclTags("tenant-1", acl)).toEqual(deriveAclTags("tenant-1", acl));
  });

  it("produces DIFFERENT tags for a different tenant with the identical acl content — never linkable across tenants", () => {
    const acl = { roleIds: ["r1"], tags: [], visibility: "Tenant" as const };
    const tagsA = deriveAclTags("tenant-a", acl);
    const tagsB = deriveAclTags("tenant-b", acl);
    expect(tagsA).not.toEqual(tagsB);
  });

  it("never emits the raw role/capability-group id or tag value verbatim", () => {
    const acl = { roleIds: ["super-secret-role-id"], tags: ["internal-only"], visibility: "Restricted" as const };
    const tags = deriveAclTags("tenant-1", acl);
    for (const tag of tags) {
      expect(tag).not.toContain("super-secret-role-id");
      expect(tag).not.toContain("internal-only");
      expect(tag).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("always includes a visibility tag even with no roles/groups/tags", () => {
    const tags = deriveAclTags("tenant-1", { tags: [], visibility: "Tenant" });
    expect(tags.length).toBeGreaterThanOrEqual(1);
  });
});

describe("unionAclTags", () => {
  it("deduplicates and sorts the union of multiple tag sets", () => {
    expect(unionAclTags(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });
});
