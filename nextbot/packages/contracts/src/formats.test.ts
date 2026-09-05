import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { uuidv7 } from "uuidv7";
import "./formats.js";
import { CreatePermissionRuleRequestSchema } from "./tool-registry.js";
import { RunEvalSuiteRequestSchema, ModelRouteChainEntrySchema } from "./agent-platform.js";

/**
 * Regression coverage for the QA-reported defect: TypeBox's `format` keyword
 * validates nothing unless the format name is explicitly registered via
 * `FormatRegistry.Set`, and an *unregistered* format makes `Value.Check` fail
 * **closed** — i.e. it returns `false` even for a value that would otherwise be
 * valid. `"uuid"` was missing from this file's registration (only `"email"`/`"uri"`
 * were registered), which silently broke every schema field using
 * `Type.String({ format: "uuid" })` — including the request schema behind
 * `POST /api/v1/admin/agent-platform/versions/:id/bind-eval-suite`.
 *
 * **Retry 3 correction.** The first fix registered `"uuid"` but with a regex that
 * hard-allowlisted the RFC 4122 version nibble to `[1-5]` — which rejects every id
 * this system actually generates, since `generateId()` (packages/db/src/id.ts) produces
 * UUIDv7 (version nibble `7`, RFC 9562). The regression tests added alongside that fix
 * used a hand-picked example UUID (v4) instead of a real id from this codebase's own
 * generator, so they stayed green while the real system stayed broken. This file now
 * calls the exact same underlying generator `generateId()` wraps — the `uuidv7()`
 * function from the `uuidv7` package (see packages/db/src/id.ts: `generateId` is a
 * one-line passthrough to it) — to produce real ids and assert against those, not a
 * convenient example. (`uuidv7` is a devDependency of this test file directly, rather
 * than depending on `@nextbot/db` itself, because `@nextbot/db` already depends on
 * `@nextbot/contracts` — importing it back from here would create the exact import
 * cycle `no-circular` in `.dependency-cruiser.cjs` forbids. Calling the same underlying
 * library function produces byte-for-byte the same id shape `generateId()` returns.)
 */
describe("formats.ts — TypeBox FormatRegistry registrations", () => {
  const UuidFieldSchema = Type.Object({ id: Type.String({ format: "uuid" }) });

  describe("uuid", () => {
    it("accepts a genuinely valid RFC 4122 UUID (v4)", () => {
      expect(Value.Check(UuidFieldSchema, { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" })).toBe(true);
    });

    it("accepts a valid UUID regardless of case", () => {
      expect(Value.Check(UuidFieldSchema, { id: "3FA85F64-5717-4562-B3FC-2C963F66AFA6" })).toBe(true);
    });

    it("rejects a structurally invalid (non-UUID) string", () => {
      expect(Value.Check(UuidFieldSchema, { id: "not-a-uuid" })).toBe(false);
    });

    it("rejects an empty string", () => {
      expect(Value.Check(UuidFieldSchema, { id: "" })).toBe(false);
    });

    it("rejects a UUID-shaped string with an invalid variant nibble", () => {
      // Variant nibble (17th hex digit, first char of the 4th group) must be one of 8/9/a/b.
      expect(Value.Check(UuidFieldSchema, { id: "3fa85f64-5717-4562-0000-2c963f66afa6" })).toBe(false);
    });

    it("rejects a non-UUID string that merely resembles the shape (wrong group lengths)", () => {
      expect(Value.Check(UuidFieldSchema, { id: "3fa85f64-5717-4562-b3fc-2c963f66afa" })).toBe(false);
    });

    /**
     * The specific verification gap from the prior failed attempt: assert against ids
     * this system's own generator actually produces, not a hand-picked example. Every
     * one of these MUST pass — a real `generateId()`/`uuidv7()` output failing here
     * reproduces the exact live defect (real HTTP POST to `bind-eval-suite` 422'ing,
     * real browser click-through showing "Invalid request.") that QA caught live.
     */
    it("accepts real UUIDv7 ids produced by this system's own generator (packages/db/src/id.ts's generateId(), which wraps uuidv7())", () => {
      for (let i = 0; i < 25; i += 1) {
        const realId = uuidv7();
        expect(Value.Check(UuidFieldSchema, { id: realId })).toBe(true);
        // Sanity-check the fixture itself is genuinely v7 — if uuidv7() ever changed its
        // output shape, we want this test to fail loudly rather than pass vacuously.
        expect(realId[14]).toBe("7");
      }
    });
  });

  describe("email", () => {
    it("still validates a well-formed address (pre-existing registration, unaffected by the uuid fix)", () => {
      expect(Value.Check(Type.Object({ e: Type.String({ format: "email" }) }), { e: "a@b.com" })).toBe(true);
    });

    it("still rejects a malformed address", () => {
      expect(Value.Check(Type.Object({ e: Type.String({ format: "email" }) }), { e: "not-an-email" })).toBe(false);
    });
  });

  describe("uri", () => {
    it("still validates a well-formed URI (pre-existing registration, unaffected by the uuid fix)", () => {
      expect(Value.Check(Type.Object({ u: Type.String({ format: "uri" }) }), { u: "https://example.com" })).toBe(true);
    });

    it("still rejects a malformed URI", () => {
      expect(Value.Check(Type.Object({ u: Type.String({ format: "uri" }) }), { u: "not a uri" })).toBe(false);
    });
  });

  /**
   * Audit: confirms real production schemas using `format: "uuid"` (found by grepping
   * this package for the class of bug reported) now validate correctly end-to-end,
   * not just the isolated `Type.Object` fixtures above. Uses a *real* id from this
   * system's own generator (`uuidv7()`, the function `generateId()` wraps) — not a
   * hand-picked example — which is precisely what the prior (incorrect) fix attempt
   * failed to do.
   */
  describe("real schemas using format: \"uuid\" (audit for the same class of gap)", () => {
    const validUuid = uuidv7();

    it("RunEvalSuiteRequestSchema.agentDefinitionVersionId validates a real UUIDv7", () => {
      expect(Value.Check(RunEvalSuiteRequestSchema, { agentDefinitionVersionId: validUuid })).toBe(true);
      expect(Value.Check(RunEvalSuiteRequestSchema, { agentDefinitionVersionId: "nope" })).toBe(false);
    });

    it("ModelRouteChainEntrySchema.credentialId (optional uuid) validates a real UUIDv7 and rejects garbage", () => {
      const base = { providerKey: "openai", model: "gpt-4o" };
      expect(Value.Check(ModelRouteChainEntrySchema, { ...base, credentialId: validUuid })).toBe(true);
      expect(Value.Check(ModelRouteChainEntrySchema, { ...base, credentialId: "nope" })).toBe(false);
    });

    it("CreatePermissionRuleRequestSchema.toolId/connectorId (optional uuid) validate a real UUID", () => {
      const base = {
        scope: "Tool" as const,
        ordinal: 0,
        conditions: {},
        effect: "Allow" as const,
      };
      expect(Value.Check(CreatePermissionRuleRequestSchema, { ...base, toolId: validUuid })).toBe(true);
      expect(Value.Check(CreatePermissionRuleRequestSchema, { ...base, connectorId: validUuid })).toBe(true);
      expect(Value.Check(CreatePermissionRuleRequestSchema, { ...base, toolId: "nope" })).toBe(false);
    });
  });
});
