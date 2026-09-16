/**
 * CSS emission — turning a token set into a custom-property block.
 *
 * ADR-0007 makes this module part of the security boundary, not a formatting
 * helper. The resolved theme is inlined into `<head>` server-side (§9.4), for
 * two reasons that are both non-negotiable: it removes the flash of default
 * theme, and it means per-tenant branding is *never* fetched client-side, so a
 * tenant's brand cannot leak into another tenant's page through any cache.
 *
 * That places token values directly inside a `<style>` element, which makes
 * every value an injection surface — and skins are untrusted input, because an
 * exported skin is a file a user can hand-edit or receive by email (§7.1).
 *
 * Two decisions follow:
 *
 *  1. **Values are re-validated at emit time, not only at save time** (§9.4).
 *     A row written by an older build, a migration, or a direct database edit
 *     still cannot inject CSS. Defence in depth is the whole point: the save
 *     path and the emit path fail independently.
 *  2. **Rejection, not escaping.** A CSS-escaped hostile value is still an
 *     unknown value in a stylesheet the whole application trusts. §7.2 narrows
 *     colours to 6-digit hex precisely so that anything else is a bug worth
 *     failing on, and this module fails on it rather than sanitising it into
 *     something that renders.
 *
 * Token *names* are allowlisted too. §9.4 states the emitter writes only
 * `--token: <validated value>;` pairs from the allowlist; an unknown name here
 * means something bypassed the schema, so it is an error rather than a
 * pass-through.
 */

import { componentTokens, COMPONENT_TOKEN_NAMES } from "./components.js";
import { primitives, PRIMITIVE_PREFIX, PRIMITIVE_TOKEN_NAMES } from "./primitives.js";
import {
  ALPHA_COLOR_TOKEN_NAMES,
  DENSITY_SCALE,
  REDUCED_MOTION_OVERRIDES,
  SEMANTIC_COLOR_TOKEN_NAMES,
  SEMANTIC_TOKEN_NAMES,
  semanticTokens,
} from "./semantic.js";
import type { ColorMode } from "./semantic.js";

/** The `<style>` element the resolved theme is inlined into (§9.4, §12.1). */
export const THEME_STYLE_ELEMENT_ID = "shj3-theme";

/**
 * 6-digit hex, and nothing else (§7.2 `$defs/color`). No named colours, no
 * `rgb()`, no `hsl()`, no `var()`, no `url()`, no gradients: the value is
 * interpolated into a custom property, so anything that can carry a function
 * call or a closing brace is a stylesheet-shaped payload.
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * The single alpha-bearing colour form, for the modal scrim (§7.2
 * `$defs/colorWithAlpha`). Space-separated components and a two-decimal alpha,
 * matching the schema byte for byte so the save path and the emit path cannot
 * disagree about what is acceptable.
 */
export const RGB_ALPHA_COLOR_PATTERN =
  /^rgb\((?:25[0-5]|2[0-4]\d|1?\d?\d) (?:25[0-5]|2[0-4]\d|1?\d?\d) (?:25[0-5]|2[0-4]\d|1?\d?\d) \/ 0?\.\d{1,2}\)$/;

/**
 * Characters a non-colour token value may contain. Deliberately narrow: it
 * admits `calc()`, `var()`, `rgb()`, `cubic-bezier()`, quoted font families,
 * lengths and unitless numbers, and admits nothing that can terminate a
 * declaration or open a new rule. Newlines are excluded by construction.
 */
const SAFE_VALUE_CHARS = /^[A-Za-z0-9#%.,()/*+\-_ "']+$/;

/**
 * CSS functions a token value may call. An allowlist rather than a denylist,
 * because the interesting attacks are the functions nobody thought of —
 * `url()` for exfiltration, `attr()` for reading the DOM, `image-set()` for a
 * remote fetch.
 */
const ALLOWED_VALUE_FUNCTIONS = new Set([
  "calc",
  "var",
  "rgb",
  "rgba",
  "min",
  "max",
  "clamp",
  "pow",
  "cubic-bezier",
]);

/** Sequences that are never legitimate inside a token value. */
const FORBIDDEN_VALUE_SEQUENCES = ["/*", "*/", "//"];

/** Longest token value the catalogue needs; the shadow scale is the widest. */
const MAX_VALUE_LENGTH = 320;

/** A token value that cannot be emitted safely. Always fatal — never sanitised. */
export class UnsafeTokenValueError extends Error {
  constructor(
    readonly token: string,
    readonly reason: string,
  ) {
    // The offending value is not interpolated into the message: this error is
    // raised on untrusted input and the message reaches logs.
    super(`Token "${token}" has an unsafe value: ${reason}`);
    this.name = "UnsafeTokenValueError";
  }
}

/** A token name outside the allowlist. Means something bypassed the schema. */
export class UnknownTokenError extends Error {
  constructor(readonly token: string) {
    super(`Token "${token}" is not part of the token catalogue and will not be emitted`);
    this.name = "UnknownTokenError";
  }
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

export function isRgbAlphaColor(value: unknown): value is string {
  return typeof value === "string" && RGB_ALPHA_COLOR_PATTERN.test(value);
}

const SEMANTIC_COLOR_NAME_SET: ReadonlySet<string> = new Set(SEMANTIC_COLOR_TOKEN_NAMES);
const ALPHA_COLOR_NAME_SET: ReadonlySet<string> = new Set(ALPHA_COLOR_TOKEN_NAMES);

/**
 * Every token name that may be emitted: layer 2 (minus breakpoints, which
 * cannot be custom properties at all — §4.9) plus layer 3.
 */
export const EMITTABLE_TOKEN_NAMES: ReadonlySet<string> = new Set([
  ...SEMANTIC_TOKEN_NAMES,
  ...COMPONENT_TOKEN_NAMES,
]);

/**
 * `--<kebab-case>` from a camelCase key. Derived rather than tabulated so §3.2's
 * naming convention cannot drift from a second hand-maintained list: a digit
 * run always starts a new segment, which is what turns `sand100` into
 * `--shj3-sand-100` and `text2xs` into `--text-2xs`.
 */
export function toCssCustomPropertyName(key: string, prefix = ""): string {
  const kebab = key
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
  return `--${prefix}${kebab}`;
}

const CUSTOM_PROPERTY_NAME_PATTERN = /^--[a-z][a-z0-9-]*$/;

/**
 * Validate a value that is about to be written into a `<style>` block.
 *
 * Colour roles get §7.2's exact patterns; everything else gets the charset and
 * function allowlist. The split is by token *name* rather than by inspecting
 * the value, because "does this look like a colour?" is the judgement an
 * attacker gets to influence.
 */
export function assertSafeCssValue(token: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new UnsafeTokenValueError(token, "not a string");
  }
  if (value.length === 0) {
    throw new UnsafeTokenValueError(token, "empty");
  }
  if (value.length > MAX_VALUE_LENGTH) {
    throw new UnsafeTokenValueError(token, `longer than ${MAX_VALUE_LENGTH} characters`);
  }

  if (SEMANTIC_COLOR_NAME_SET.has(token)) {
    if (ALPHA_COLOR_NAME_SET.has(token)) {
      if (!isRgbAlphaColor(value)) {
        throw new UnsafeTokenValueError(token, "not an `rgb(r g b / a)` colour");
      }
      return value;
    }
    if (!isHexColor(value)) {
      throw new UnsafeTokenValueError(token, "not a 6-digit hex colour");
    }
    return value;
  }

  if (!SAFE_VALUE_CHARS.test(value)) {
    throw new UnsafeTokenValueError(token, "contains a character that is not permitted in a value");
  }
  for (const sequence of FORBIDDEN_VALUE_SEQUENCES) {
    if (value.includes(sequence)) {
      throw new UnsafeTokenValueError(token, `contains the sequence "${sequence}"`);
    }
  }
  for (const match of value.matchAll(/([A-Za-z][A-Za-z-]*)\s*\(/g)) {
    const fn = match[1]?.toLowerCase() ?? "";
    if (!ALLOWED_VALUE_FUNCTIONS.has(fn)) {
      throw new UnsafeTokenValueError(token, `calls the disallowed function "${fn}()"`);
    }
  }
  return value;
}

/** Selector charset for a generated rule. Cannot open a block or an at-rule. */
const SAFE_SELECTOR = /^[A-Za-z0-9_\-.#:[\]="' >~+,()]+$/;

export interface SerializeOptions {
  /** Rule selector. Defaults to `:root`, which is where a theme belongs (§3.4). */
  readonly selector?: string;
  /** Emit without whitespace, for the inlined `<head>` block. */
  readonly minify?: boolean;
  /** Names that may be emitted. Defaults to the layer-2 + layer-3 catalogue. */
  readonly allow?: ReadonlySet<string>;
  /** Prefix inserted after `--`. Only layer 1 uses one (§3.2 rule 1). */
  readonly prefix?: string;
}

/**
 * Serialize a token set into one CSS rule of custom-property declarations.
 *
 * Throws rather than skipping on the first bad name or value: a partially
 * emitted theme is a half-applied theme, and §2 P7 forbids one.
 */
export function serializeTokens(
  tokens: Readonly<Record<string, string>>,
  options: SerializeOptions = {},
): string {
  const selector = options.selector ?? ":root";
  const allow = options.allow ?? EMITTABLE_TOKEN_NAMES;
  const prefix = options.prefix ?? "";
  const minify = options.minify ?? false;

  if (!SAFE_SELECTOR.test(selector)) {
    throw new UnsafeTokenValueError(selector, "not a permitted selector");
  }

  const declarations: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    if (!allow.has(key)) {
      throw new UnknownTokenError(key);
    }
    const property = toCssCustomPropertyName(key, prefix);
    if (!CUSTOM_PROPERTY_NAME_PATTERN.test(property)) {
      throw new UnsafeTokenValueError(key, "does not derive a valid custom property name");
    }
    declarations.push(`${property}:${minify ? "" : " "}${assertSafeCssValue(key, value)};`);
  }

  return minify
    ? `${selector}{${declarations.join("")}}`
    : `${selector} {\n${declarations.map((d) => `  ${d}`).join("\n")}\n}`;
}

/** Layer 1. Loaded once, present in no skin (§3.1). */
export function serializePrimitiveLayer(options: SerializeOptions = {}): string {
  return serializeTokens(primitives, {
    ...options,
    prefix: PRIMITIVE_PREFIX,
    allow: new Set(PRIMITIVE_TOKEN_NAMES),
  });
}

/** Layer 2 defaults for a mode — the system theme a skin is merged over. */
export function serializeSemanticLayer(mode: ColorMode, options: SerializeOptions = {}): string {
  return serializeTokens(semanticTokens(mode), options);
}

/** Layer 3. Derived from layer 2, so it never needs re-emitting per skin. */
export function serializeComponentLayer(options: SerializeOptions = {}): string {
  return serializeTokens(componentTokens, options);
}

/**
 * The full static stylesheet: all three layers, the two density stops and the
 * reduced-motion overrides.
 *
 * Density is an attribute rule rather than a `:root` declaration (§4.7), so a
 * skin's density arrives as `data-density` on `<html>` and not as a custom
 * property — an attribute rule outranks `:root`, and emitting both would leave
 * the lower-specificity one silently ignored.
 */
export function serializeBaseStylesheet(mode: ColorMode, options: SerializeOptions = {}): string {
  const density = Object.entries(DENSITY_SCALE).map(([name, value]) =>
    serializeTokens({ densityScale: value }, { ...options, selector: `[data-density="${name}"]` }),
  );
  const reducedMotion = serializeTokens(REDUCED_MOTION_OVERRIDES, options);
  const separator = options.minify ? "" : "\n\n";

  return [
    serializePrimitiveLayer(options),
    serializeSemanticLayer(mode, options),
    serializeComponentLayer(options),
    ...density,
    `@media (prefers-reduced-motion: reduce) {${separator}${reducedMotion}${separator}}`,
  ].join(separator);
}
