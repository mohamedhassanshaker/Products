import { describe, expect, it } from "vitest";
import { classifyDrift, computeDriftDedupeKey } from "./drift-classification.js";

describe("classifyDrift (ADR-0014 §2.2's decision table)", () => {
  it("classifies a brand-new tool as ItemAdded", () => {
    const result = classifyDrift([{ name: "get_order", schemaHash: "h1" }], [
      { name: "get_order", schemaHash: "h1" },
      { name: "cancel_order", schemaHash: "h3" },
    ]);
    expect(result).toEqual([{ changeKind: "ItemAdded", itemName: "cancel_order", oldSchemaHash: null, newSchemaHash: "h3" }]);
  });

  it("classifies a changed input schema as SchemaChanged — the security-critical row", () => {
    const result = classifyDrift([{ name: "get_order", schemaHash: "h1" }], [{ name: "get_order", schemaHash: "h2" }]);
    expect(result).toEqual([{ changeKind: "SchemaChanged", itemName: "get_order", oldSchemaHash: "h1", newSchemaHash: "h2" }]);
  });

  it("classifies a disappeared tool as ItemRemoved", () => {
    const result = classifyDrift([{ name: "get_order", schemaHash: "h1" }], []);
    expect(result).toEqual([{ changeKind: "ItemRemoved", itemName: "get_order", oldSchemaHash: "h1", newSchemaHash: null }]);
  });

  it("an unchanged tool (same name, same schemaHash) produces no classification at all", () => {
    const result = classifyDrift([{ name: "get_order", schemaHash: "h1" }], [{ name: "get_order", schemaHash: "h1" }]);
    expect(result).toEqual([]);
  });

  it("classifies multiple simultaneous changes independently", () => {
    const pinned = [
      { name: "get_order", schemaHash: "h1" },
      { name: "cancel_order", schemaHash: "h2" },
      { name: "refund_order", schemaHash: "h3" },
    ];
    const live = [
      { name: "get_order", schemaHash: "h1" }, // unchanged
      { name: "cancel_order", schemaHash: "h2-changed" }, // SchemaChanged
      // refund_order removed
      { name: "new_tool", schemaHash: "h4" }, // ItemAdded
    ];
    const result = classifyDrift(pinned, live);
    expect(result).toContainEqual({ changeKind: "SchemaChanged", itemName: "cancel_order", oldSchemaHash: "h2", newSchemaHash: "h2-changed" });
    expect(result).toContainEqual({ changeKind: "ItemRemoved", itemName: "refund_order", oldSchemaHash: "h3", newSchemaHash: null });
    expect(result).toContainEqual({ changeKind: "ItemAdded", itemName: "new_tool", oldSchemaHash: null, newSchemaHash: "h4" });
    expect(result).toHaveLength(3);
  });
});

describe("computeDriftDedupeKey (ADR-0014's idempotency key)", () => {
  it("is deterministic for identical inputs", () => {
    const input = { pinnedVersionId: "v1", changeKind: "SchemaChanged" as const, itemKind: "Tool", itemName: "get_order", newSchemaHash: "h2" };
    expect(computeDriftDedupeKey(input)).toBe(computeDriftDedupeKey({ ...input }));
  });

  it("differs when any component differs", () => {
    const base = { pinnedVersionId: "v1", changeKind: "SchemaChanged" as const, itemKind: "Tool", itemName: "get_order", newSchemaHash: "h2" };
    expect(computeDriftDedupeKey(base)).not.toBe(computeDriftDedupeKey({ ...base, itemName: "cancel_order" }));
    expect(computeDriftDedupeKey(base)).not.toBe(computeDriftDedupeKey({ ...base, newSchemaHash: "h3" }));
    expect(computeDriftDedupeKey(base)).not.toBe(computeDriftDedupeKey({ ...base, changeKind: "ItemRemoved" }));
  });
});
