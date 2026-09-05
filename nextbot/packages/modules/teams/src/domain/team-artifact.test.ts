import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { TeamValidationError } from "@nextbot/contracts";
import { hashTeamArtifact, parseAgentPin, parseTeamArtifact, serializeTeamArtifact } from "./team-artifact.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03, LLD §14.7.2) — the
 * authored team artifact's structural contract. FR-ORC-03's two literal enforcement
 * points are asserted here at the artifact level (and again at the DB level in
 * `teams-schema.int.test.ts`): a missing `failureMode` fails validation, and
 * `limits` is all-or-nothing.
 */
const VALID = `kind: team
name: support_team
version: 1
supervisor:
  agent: triage@1.0.0
  route: chat.router
limits:
  maxDepth: 2
  maxFanOut: 2
  maxDelegations: 4
  runBudget:
    usd: 1
    seconds: 120
  thrashWindow:
    repeats: 2
    similarityThreshold: 0.92
failureMode: Escalate
members:
  - key: billing
    agent: billing_agent@1.0.0
    delegationTier: Tier2
    invokeWhen: the customer asks about an invoice
`;

describe("parseTeamArtifact (FR-ORC-03)", () => {
  it("parses a complete, valid artifact", () => {
    const artifact = parseTeamArtifact(VALID);
    expect(artifact.name).toBe("support_team");
    expect(artifact.failureMode).toBe("Escalate");
    expect(artifact.members).toHaveLength(1);
    expect(artifact.limits.thrashWindow.similarityThreshold).toBeCloseTo(0.92);
  });

  it("rejects a team version with NO failureMode declared — FR-ORC-03's literal enforcement", () => {
    const withoutFailureMode = VALID.replace("failureMode: Escalate\n", "");
    expect(() => parseTeamArtifact(withoutFailureMode)).toThrow(TeamValidationError);
    try {
      parseTeamArtifact(withoutFailureMode);
    } catch (err) {
      expect((err as TeamValidationError).fields?.some((f) => f.path.includes("failureMode"))).toBe(true);
    }
  });

  it("rejects a PARTIAL limits object — an omitted safety ceiling is never defaulted", () => {
    const partial = VALID.replace("  maxFanOut: 2\n", "");
    expect(() => parseTeamArtifact(partial)).toThrow(TeamValidationError);
  });

  it("rejects a partial runBudget (usd without seconds)", () => {
    const partial = VALID.replace("    seconds: 120\n", "");
    expect(() => parseTeamArtifact(partial)).toThrow(TeamValidationError);
  });

  it("rejects a partial thrashWindow", () => {
    const partial = VALID.replace("    similarityThreshold: 0.92\n", "");
    expect(() => parseTeamArtifact(partial)).toThrow(TeamValidationError);
  });

  it("rejects a team with zero members", () => {
    const noMembers = VALID.slice(0, VALID.indexOf("members:")) + "members: []\n";
    expect(() => parseTeamArtifact(noMembers)).toThrow(TeamValidationError);
  });

  it("rejects an UNKNOWN key rather than silently dropping it (additionalProperties: false is load-bearing)", () => {
    // The exact class of mistake `additionalProperties: false` exists for: a
    // snake_case misspelling that would otherwise leave `failureMode` undeclared
    // AND leave the author believing they declared it.
    const misspelled = VALID.replace("failureMode: Escalate", "failure_mode: Escalate");
    expect(() => parseTeamArtifact(misspelled)).toThrow(TeamValidationError);
  });

  it("rejects an unsupported failureMode value", () => {
    expect(() => parseTeamArtifact(VALID.replace("failureMode: Escalate", "failureMode: Retry"))).toThrow(TeamValidationError);
  });

  it("rejects a maxDepth above the delegation_event depth ceiling (8)", () => {
    expect(() => parseTeamArtifact(VALID.replace("maxDepth: 2", "maxDepth: 9"))).toThrow(TeamValidationError);
  });

  it("reports a YAML syntax error as a validation error, not an unhandled throw", () => {
    expect(() => parseTeamArtifact("kind: team\n  bad indent: [")).toThrow(TeamValidationError);
  });

  it("round-trips: parse(serialize(artifact)) is deep-equal to the original", () => {
    const artifact = parseTeamArtifact(VALID);
    expect(parseTeamArtifact(serializeTeamArtifact(artifact))).toEqual(artifact);
  });
});

describe("hashTeamArtifact", () => {
  it("is stable across key ordering — two structurally identical artifacts hash identically", () => {
    const a = parseTeamArtifact(VALID);
    const reordered = yaml.load(yaml.dump({ members: a.members, failureMode: a.failureMode, limits: a.limits, supervisor: a.supervisor, version: a.version, name: a.name, kind: a.kind }));
    expect(hashTeamArtifact(reordered)).toBe(hashTeamArtifact(a));
  });

  it("changes when ANY nested field changes (the collision bug this project has hit twice)", () => {
    const a = parseTeamArtifact(VALID);
    const b = parseTeamArtifact(VALID.replace("maxDepth: 2", "maxDepth: 3"));
    expect(hashTeamArtifact(a)).not.toBe(hashTeamArtifact(b));
  });

  it("changes when a member's invokeWhen changes", () => {
    const a = parseTeamArtifact(VALID);
    const b = parseTeamArtifact(VALID.replace("the customer asks about an invoice", "the customer asks about shipping"));
    expect(hashTeamArtifact(a)).not.toBe(hashTeamArtifact(b));
  });
});

describe("parseAgentPin", () => {
  it("splits a well-formed pin", () => {
    expect(parseAgentPin("billing_agent@1.0.0")).toEqual({ name: "billing_agent", version: "1.0.0" });
  });

  it("splits on the LAST '@' so a version containing '@' is not silently truncated", () => {
    expect(parseAgentPin("a@b@1.0.0")).toEqual({ name: "a@b", version: "1.0.0" });
  });

  it("returns null for a pin with no version", () => {
    expect(parseAgentPin("billing_agent")).toBeNull();
    expect(parseAgentPin("billing_agent@")).toBeNull();
    expect(parseAgentPin("@1.0.0")).toBeNull();
  });
});
