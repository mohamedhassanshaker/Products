import { describe, expect, it } from "vitest";
import { computeSchemaHash, computeManifestHash } from "./manifest-hash.js";

describe("computeSchemaHash (ADR-0014 §2.1 canonicalization)", () => {
  it("Verification 4 (cosmetic-change test): re-serializing the same schema with different key order produces the same hash", () => {
    const a = { type: "object", properties: { orderId: { type: "string" }, quantity: { type: "integer" } } };
    const b = { properties: { quantity: { type: "integer" }, orderId: { type: "string" } }, type: "object" };
    expect(computeSchemaHash(a)).toBe(computeSchemaHash(b));
  });

  it("a genuine schema change (a new required property) produces a different hash", () => {
    const a = { type: "object", properties: { orderId: { type: "string" } } };
    const b = { type: "object", properties: { orderId: { type: "string" }, reason: { type: "string" } } };
    expect(computeSchemaHash(a)).not.toBe(computeSchemaHash(b));
  });

  it("default/title/description are part of the hash (they reach the model, ADR-0014 §2.1)", () => {
    const a = { type: "string" };
    const b = { type: "string", description: "The customer's order id" };
    expect(computeSchemaHash(a)).not.toBe(computeSchemaHash(b));
  });
});

describe("computeManifestHash (ADR-0014 §2.1)", () => {
  it("is order-independent over the input item list (sorted by kind,name before hashing)", () => {
    const items = [
      { kind: "Tool", name: "get_order", schemaHash: "h1" },
      { kind: "Tool", name: "refund_order", schemaHash: "h2" },
    ];
    expect(computeManifestHash(items)).toBe(computeManifestHash([...items].reverse()));
  });

  it("changes when any item's schemaHash changes", () => {
    const items = [{ kind: "Tool", name: "get_order", schemaHash: "h1" }];
    const changed = [{ kind: "Tool", name: "get_order", schemaHash: "h2" }];
    expect(computeManifestHash(items)).not.toBe(computeManifestHash(changed));
  });

  it("changes when an item is added or removed", () => {
    const items = [{ kind: "Tool", name: "get_order", schemaHash: "h1" }];
    const withExtra = [...items, { kind: "Tool", name: "refund_order", schemaHash: "h2" }];
    expect(computeManifestHash(items)).not.toBe(computeManifestHash(withExtra));
  });
});
