/**
 * §12.4's second suite: the skin validator and the emitter treated as what they
 * are — the boundary between an untrusted file and a `<style>` block the whole
 * application trusts (§7.1, §7.4, §9.4).
 *
 * The hostile fixtures are §12.4's list: a colour field carrying a CSS payload,
 * a data-URI logo, a raw `font-family` string, an unknown `schemaVersion`, an
 * oversized file, a deeply nested object. Each must be rejected at the right
 * stage with a locatable message, because §7.4 stage 2 requires every violation
 * to be reported with its JSON Pointer path rather than a bare 400.
 *
 * The emitter is tested against the same payloads even though the validator
 * already rejects them. That duplication is the point: §9.4 requires
 * re-validation at emit time, so a row written by an older build, a migration
 * or a direct database edit still cannot inject CSS.
 */

import { describe, expect, it } from "vitest";
import {
  serializeBaseStylesheet,
  serializeTokens,
  toCssCustomPropertyName,
  UnknownTokenError,
  UnsafeTokenValueError,
} from "./css.js";
import { semanticColors } from "./semantic.js";
import {
  MAX_SKIN_BYTES,
  parseSkinDocument,
  resolveSkinTokens,
  serializeSkin,
  validateSkin,
} from "./skin.js";
import type { Skin } from "./skin.js";
import { SHARJAH_DARK, SHARJAH_DEFAULT } from "./skins/index.js";

/** A CSS payload shaped like a stylesheet — §7.2's stated reason for hex-only colours. */
const CSS_INJECTION_PAYLOAD = "red; } body { display:none";

/** A structurally valid skin, as a mutable JSON value, for hostile mutation. */
function validDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SHARJAH_DEFAULT)) as Record<string, unknown>;
}

function tokensOf(document: Record<string, unknown>): Record<string, unknown> {
  return document.tokens as Record<string, unknown>;
}

function paths(result: ReturnType<typeof validateSkin>): readonly string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe("the shipped skins validate against their own schema", () => {
  for (const skin of [SHARJAH_DEFAULT, SHARJAH_DARK]) {
    it(`${skin.metadata.name} is a valid skin document`, () => {
      const result = validateSkin(JSON.parse(JSON.stringify(skin)));
      expect(result.ok ? [] : result.issues).toEqual([]);
    });
  }

  it("round-trips through JSON exactly (FR-THEME-10)", () => {
    const exported = JSON.stringify(SHARJAH_DEFAULT);
    const result = validateSkin(JSON.parse(exported));

    expect(result.ok).toBe(true);
    expect(JSON.parse(exported)).toEqual(JSON.parse(JSON.stringify(SHARJAH_DEFAULT)));
  });

  it("carries all 66 colour roles, so nothing is filled from hidden state", () => {
    expect(Object.keys(SHARJAH_DEFAULT.tokens)).toHaveLength(66);
    expect(resolveSkinTokens(SHARJAH_DEFAULT, "light")).toEqual(semanticColors.light);
  });
});

describe("schema version (§7.2)", () => {
  it("rejects a missing version", () => {
    const document = validDocument();
    delete document.schemaVersion;
    expect(paths(validateSkin(document))).toContain("/schemaVersion");
  });

  it("rejects a version this build does not know, rather than coercing it", () => {
    const document = validDocument();
    document.schemaVersion = 2;
    expect(paths(validateSkin(document))).toContain("/schemaVersion");
  });

  it("rejects a stringly-typed version", () => {
    const document = validDocument();
    document.schemaVersion = "1";
    expect(paths(validateSkin(document))).toContain("/schemaVersion");
  });
});

describe("closed objects (§7.4 stage 2)", () => {
  it("rejects an unknown top-level key instead of dropping it", () => {
    const document = validDocument();
    document.css = ":root { --primary: red }";
    expect(paths(validateSkin(document))).toContain("/css");
  });

  it("rejects an unknown metadata key", () => {
    const document = validDocument();
    (document.metadata as Record<string, unknown>).injected = true;
    expect(paths(validateSkin(document))).toContain("/metadata/injected");
  });

  it("reports every violation, not the first", () => {
    const document = validDocument();
    delete document.mode;
    delete document.direction;
    tokensOf(document).primary = "not-a-colour";

    const issues = paths(validateSkin(document));
    expect(issues).toContain("/mode");
    expect(issues).toContain("/direction");
    expect(issues).toContain("/tokens/primary");
  });
});

describe("token names (§3.1's asymmetry)", () => {
  it("rejects an unknown token name", () => {
    const document = validDocument();
    tokensOf(document).brandColour = "#123456";
    expect(paths(validateSkin(document))).toContain("/tokens/brandColour");
  });

  it("rejects a layer-1 primitive, which is what stops a skin redefining a hue", () => {
    const document = validDocument();
    tokensOf(document)["--shj3-green-600"] = "#FF0000";
    expect(paths(validateSkin(document))).toContain("/tokens/--shj3-green-600");
  });

  it("rejects a layer-3 component token smuggled into the colour map", () => {
    const document = validDocument();
    tokensOf(document).buttonRadius = "#123456";
    expect(paths(validateSkin(document))).toContain("/tokens/buttonRadius");
  });

  it("rejects a document missing a required token", () => {
    const document = validDocument();
    delete tokensOf(document).primary;
    expect(paths(validateSkin(document))).toContain("/tokens/primary");
  });
});

describe("colour values (§7.2 $defs/color)", () => {
  const malformed = [
    "red",
    "#FFF",
    "#GGGGGG",
    "rgb(255, 0, 0)",
    "hsl(120 50% 50%)",
    "var(--shj3-green-600)",
    "url(https://evil.example/x)",
    "#1F6F5C;",
    " #1F6F5C",
    CSS_INJECTION_PAYLOAD,
  ];

  for (const value of malformed) {
    it(`rejects ${JSON.stringify(value)} as a colour`, () => {
      const document = validDocument();
      tokensOf(document).primary = value;
      expect(paths(validateSkin(document))).toContain("/tokens/primary");
    });
  }

  it("accepts the one alpha-bearing role in its documented form only", () => {
    const document = validDocument();
    tokensOf(document).overlay = "rgb(32 36 43 / 0.44)";
    expect(validateSkin(document).ok).toBe(true);

    tokensOf(document).overlay = "rgba(32, 36, 43, 0.44)";
    expect(paths(validateSkin(document))).toContain("/tokens/overlay");
  });

  it("rejects a hex colour anywhere else a colour is not expected", () => {
    const document = validDocument();
    tokensOf(document).background = 255;
    expect(paths(validateSkin(document))).toContain("/tokens/background");
  });
});

describe("assets and fonts (§7.2's narrowings)", () => {
  it("rejects a logo given as a URL", () => {
    const document = validDocument();
    document.assets = { logoLight: { url: "https://evil.example/logo.svg" } };
    expect(paths(validateSkin(document))).toContain("/assets/logoLight/url");
  });

  it("rejects a logo given as a data URI in the assetId slot", () => {
    const document = validDocument();
    document.assets = {
      logoLight: { assetId: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    };
    expect(paths(validateSkin(document))).toContain("/assets/logoLight/assetId");
  });

  it("rejects a raw font-family string in place of an allowlisted stack id", () => {
    const document = validDocument();
    document.typography = { fontSans: '"Evil Sans", sans-serif' };
    expect(paths(validateSkin(document))).toContain("/typography/fontSans");
  });

  it("rejects a base size outside the enumerated set", () => {
    const document = validDocument();
    document.typography = { baseSize: "0.5rem" };
    expect(paths(validateSkin(document))).toContain("/typography/baseSize");
  });

  it("rejects a scale ratio outside 1.1-1.333", () => {
    const document = validDocument();
    document.typography = { scaleRatio: 3 };
    expect(paths(validateSkin(document))).toContain("/typography/scaleRatio");
  });

  it("rejects a geometry value outside its stop list", () => {
    const document = validDocument();
    document.geometry = { radiusRoot: "42rem" };
    expect(paths(validateSkin(document))).toContain("/geometry/radiusRoot");
  });
});

describe("stage 1 — size and parse (§7.4)", () => {
  it("accepts a well-formed document", () => {
    expect(parseSkinDocument(JSON.stringify(SHARJAH_DEFAULT)).ok).toBe(true);
  });

  it("rejects text that is not JSON", () => {
    expect(parseSkinDocument("<html></html>").ok).toBe(false);
  });

  it("rejects an oversized file without parsing it", () => {
    const document = validDocument();
    (document.metadata as Record<string, unknown>).description = "x".repeat(MAX_SKIN_BYTES);
    const result = parseSkinDocument(JSON.stringify(document));

    expect(result.ok).toBe(false);
    // A size failure, not a schema failure: the payload was never walked.
    expect(paths(result)).toEqual([""]);
  });

  it("rejects a document nested deeper than the limit", () => {
    let nested: unknown = "deep";
    for (let i = 0; i < 40; i += 1) {
      nested = { nested };
    }
    const document = validDocument();
    document.metadata = nested;

    expect(paths(parseSkinDocument(JSON.stringify(document)))).toEqual([""]);
  });
});

describe("emit-time re-validation (§9.4)", () => {
  it("derives custom property names from the token key", () => {
    expect(toCssCustomPropertyName("mutedForeground")).toBe("--muted-foreground");
    expect(toCssCustomPropertyName("chart1")).toBe("--chart-1");
    expect(toCssCustomPropertyName("text2xs")).toBe("--text-2xs");
    expect(toCssCustomPropertyName("sand100", "shj3-")).toBe("--shj3-sand-100");
  });

  it("emits the resolved skin as a single :root block", () => {
    const css = serializeSkin(SHARJAH_DEFAULT, "light", { minify: true });

    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--primary:#1F6F5C;");
    expect(css).toContain('--sidebar-style:"neutral";');
    // Exactly one rule: no stray brace can have been introduced by a value.
    expect(css.match(/[{}]/g)).toEqual(["{", "}"]);
  });

  it("does not emit density, which is applied as an attribute instead (§4.7)", () => {
    // A `[data-density]` rule outranks `:root`, so a token here would be
    // silently ignored — worse than absent, because it looks applied.
    expect(serializeSkin(SHARJAH_DEFAULT, "light")).not.toContain("--density-scale");
    expect(serializeBaseStylesheet("light")).toContain('[data-density="compact"]');
  });

  it("refuses a CSS payload that reached the emitter without passing validation", () => {
    expect(() => serializeTokens({ primary: CSS_INJECTION_PAYLOAD })).toThrow(
      UnsafeTokenValueError,
    );
    expect(() => serializeTokens({ background: "#F6F5F1;--primary:red" })).toThrow(
      UnsafeTokenValueError,
    );
    expect(() => serializeTokens({ mutedForeground: "inherit" })).toThrow(UnsafeTokenValueError);
  });

  it("refuses a disallowed function in a non-colour value", () => {
    // The hole a colour pattern alone would leave: typography and shadow values
    // legitimately call calc() and var(), so they are validated by function
    // allowlist rather than by shape.
    expect(() => serializeTokens({ fontSans: "url(https://evil.example/f.woff2)" })).toThrow(
      UnsafeTokenValueError,
    );
    expect(() => serializeTokens({ shadowXs: "0 0 0 rgb(0 0 0 / attr(data-x))" })).toThrow(
      UnsafeTokenValueError,
    );
    expect(() => serializeTokens({ fontSizeBase: "1rem /* } */" })).toThrow(UnsafeTokenValueError);
  });

  it("refuses a token name outside the catalogue", () => {
    // An unknown name at emit time means something bypassed the schema, so it
    // is an error rather than a pass-through (§9.4's allowlist).
    expect(() => serializeTokens({ notAToken: "#123456" })).toThrow(UnknownTokenError);
    expect(() => serializeTokens({ bpSm: "560px" })).toThrow(UnknownTokenError);
  });

  it("emits a skin whose optional tokens were filled from the system default", () => {
    const partial: Skin = {
      schemaVersion: 1,
      metadata: { name: "Minimal", createdAt: "2026-09-08T00:00:00Z" },
      mode: "dark",
      direction: "locale",
      tokens: {
        background: "#14171C",
        foreground: "#EDEEF0",
        card: "#1B1F26",
        cardForeground: "#EDEEF0",
        primary: "#4FB79B",
        primaryForeground: "#14171C",
        border: "#2E343E",
        ring: "#5FC7AA",
      },
    };

    expect(validateSkin(JSON.parse(JSON.stringify(partial))).ok).toBe(true);
    expect(resolveSkinTokens(partial, "dark").warningSubtle).toBe(
      semanticColors.dark.warningSubtle,
    );
    expect(serializeSkin(partial, "dark", { minify: true })).toContain("--warning-subtle:#38290F;");
  });
});
