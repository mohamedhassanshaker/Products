import { describe, expect, it } from "vitest";
import { canonicalize, hashDefinitionArtifact } from "./definition-hash.js";

describe("canonicalize", () => {
  it("produces identical output for objects with differently-ordered keys, at every nesting level", () => {
    const a = { b: 2, a: 1, nested: { y: 2, x: 1 } };
    const b = { a: 1, b: 2, nested: { x: 1, y: 2 } };
    expect(JSON.stringify(canonicalize(a))).toBe(JSON.stringify(canonicalize(b)));
  });

  it("does not collapse distinct nested keys the way JSON.stringify's array-replacer would (regression guard)", () => {
    const a = { spec: { instructions: "hello" } };
    const b = { spec: { instructions: "goodbye" } };
    expect(JSON.stringify(canonicalize(a))).not.toBe(JSON.stringify(canonicalize(b)));
  });

  it("preserves array order (arrays are ordered, unlike object keys)", () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [3, 2, 1] };
    expect(JSON.stringify(canonicalize(a))).not.toBe(JSON.stringify(canonicalize(b)));
  });
});

describe("hashDefinitionArtifact", () => {
  it("is deterministic for the same logical content regardless of key order", () => {
    const a = { metadata: { name: "x", version: "1.0.0" }, spec: { instructions: "hi" } };
    const b = { spec: { instructions: "hi" }, metadata: { version: "1.0.0", name: "x" } };
    expect(hashDefinitionArtifact(a)).toBe(hashDefinitionArtifact(b));
  });

  it("changes when meaningful content changes", () => {
    const a = { spec: { instructions: "hi" } };
    const b = { spec: { instructions: "bye" } };
    expect(hashDefinitionArtifact(a)).not.toBe(hashDefinitionArtifact(b));
  });

  it("returns a 64-char hex sha256 digest", () => {
    expect(hashDefinitionArtifact({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
