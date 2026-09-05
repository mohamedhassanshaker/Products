import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { humanizeYamlParseError } from "./humanize-yaml-error.js";

describe("humanizeYamlParseError (QA Defect U3)", () => {
  it("names the (1-based) line for a real js-yaml parse error instead of the raw parser message", () => {
    let caught: unknown;
    try {
      yaml.load("a:\n b: c\n  d: e\n");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(humanizeYamlParseError(caught)).toBe("There's a syntax error in your YAML — check line 3.");
    // Never the raw parser output.
    expect(humanizeYamlParseError(caught)).not.toMatch(/bad indentation/i);
    expect(humanizeYamlParseError(caught)).not.toContain("-------");
  });

  it("falls back to a generic message when the error has no attributable line", () => {
    expect(humanizeYamlParseError(new Error("something else"))).toBe("There's a syntax error in your YAML — double-check indentation and formatting.");
    expect(humanizeYamlParseError(null)).toBe("There's a syntax error in your YAML — double-check indentation and formatting.");
  });
});
