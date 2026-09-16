/**
 * Skins — the named, saveable theme preset, and its validator
 * (`design-system.md` §7; ADR-0007's "Skins" section).
 *
 * A skin is a JSON document of layer-2 semantic token values plus an
 * allowlisted subset of layer-3, asset references, and direction/mode defaults.
 * It never contains layer-1 primitives (§3.1) and never contains CSS.
 *
 * **Import is untrusted input.** An exported skin is a file a user can
 * hand-edit or receive by email, so the import path treats it exactly as it
 * would a request body from an anonymous caller. That is why this validator is
 * hand-written against §7.2's JSON Schema rather than delegating to a schema
 * library: this package is consumed by both the Next.js app and the emission
 * path, and a dependency here is a dependency in the rendering hot path. It is
 * also why every object is closed (`additionalProperties: false`) — a silently
 * dropped key is a token that stays at its old value, which is a half-applied
 * theme (§7.4 stage 2).
 *
 * ## Which of §7.4's five stages live here
 *
 *  1. Size & parse — `parseSkinDocument`.
 *  2. Schema — `validateSkin`. Reports *every* violation with its JSON Pointer
 *     path; never coerces, never drops.
 *  3. Reference resolution — **not here.** Resolving an `assetId` against the
 *     importing principal's tenant needs the tenant-scoped data handle, so it
 *     belongs to the theming module. This file validates that an `assetId` is a
 *     UUID and nothing else, which is what makes stage 3 a lookup rather than a
 *     parse of attacker-controlled text.
 *  4. Completeness — `resolveSkinTokens`, filled from the **system default for
 *     the declared mode**, never from the tenant's current theme: filling from
 *     current state would make an import's result depend on hidden state.
 *  5. Contrast — `contrast.ts`.
 */

import { isHexColor, isRgbAlphaColor, serializeTokens, type SerializeOptions } from "./css.js";
import {
  FONT_STACK_IDS,
  fontStacks,
  RADIUS_ROOT_STOPS,
  SEMANTIC_COLOR_TOKEN_NAMES,
  SHADOW_DEPTH_STOPS,
  semanticColors,
  type ColorMode,
  type FontStackRef,
  type SemanticColorTokenName,
  type SemanticColorTokens,
} from "./semantic.js";

/** Bumped only for a breaking change. An unknown version is rejected, never coerced (§7.2). */
export const SKIN_SCHEMA_VERSION = 1;

/** Stage 1 limits (§7.4). A hostile-size payload is refused before it is parsed. */
export const MAX_SKIN_BYTES = 64 * 1024;
export const MAX_SKIN_DEPTH = 8;

export type SkinMode = "light" | "dark" | "system";

/**
 * `locale` — the default and the recommended value — means direction follows
 * the active locale (§7.2). The explicit values exist for preview and for the
 * rare tenant that wants a fixed direction.
 */
export type SkinDirection = "ltr" | "rtl" | "locale";

export type SkinDensity = "compact" | "comfortable";
export type SidebarStyle = "neutral" | "brand" | "contrast";

export interface SkinAssetRef {
  /**
   * Reference to a row in the tenant's Assets table. Not a URL and not a data
   * URI: a URL makes the app fetch an attacker's origin on every page load, and
   * a data URI lets an SVG logo carry script (§7.2).
   */
  readonly assetId: string;
  readonly alt?: string;
}

export interface SkinMetadata {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  /**
   * Informational only. On import this field is ignored and replaced with the
   * importing principal's tenant, so it can never be used to target another
   * tenant (§7.2, §7.4 stage 3).
   */
  readonly tenant?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly basedOn?: string;
  /** Set by the platform for shipped skins. Ignored on import. */
  readonly readOnly?: boolean;
}

export interface SkinAssets {
  readonly appTitle?: string;
  readonly logoLight?: SkinAssetRef;
  readonly logoDark?: SkinAssetRef;
  readonly logoMark?: SkinAssetRef;
  readonly favicon?: SkinAssetRef;
}

export interface SkinTypography {
  readonly fontSans?: FontStackRef;
  readonly fontMono?: FontStackRef;
  readonly fontArabic?: FontStackRef;
  /** 13, 14, 15 or 16px. Enumerated so a skin cannot ship 9px body text (§7.2). */
  readonly baseSize?: "0.8125rem" | "0.875rem" | "0.9375rem" | "1rem";
  readonly scaleRatio?: number;
  readonly baseWeight?: 400 | 500;
}

export interface SkinGeometry {
  readonly radiusRoot?: (typeof RADIUS_ROOT_STOPS)[number];
  readonly density?: SkinDensity;
  readonly shadowDepth?: (typeof SHADOW_DEPTH_STOPS)[number];
  readonly sidebarStyle?: SidebarStyle;
  readonly sidebarWidth?: "14rem" | "16rem" | "18rem";
}

/**
 * Tokens a skin must carry. §7.2's `tokens.required` — the eight roles without
 * which no surface can be drawn at all, so a document missing one is rejected
 * rather than half-filled.
 */
export const REQUIRED_SKIN_TOKENS = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "primary",
  "primaryForeground",
  "border",
  "ring",
] as const satisfies readonly SemanticColorTokenName[];

export type RequiredSkinTokenName = (typeof REQUIRED_SKIN_TOKENS)[number];

export type SkinTokens = { readonly [K in RequiredSkinTokenName]: string } & {
  readonly [K in Exclude<SemanticColorTokenName, RequiredSkinTokenName>]?: string;
};

export interface Skin {
  readonly schemaVersion: typeof SKIN_SCHEMA_VERSION;
  readonly metadata: SkinMetadata;
  readonly mode: SkinMode;
  readonly direction: SkinDirection;
  readonly assets?: SkinAssets;
  readonly typography?: SkinTypography;
  readonly geometry?: SkinGeometry;
  readonly tokens: SkinTokens;
}

/** One schema violation, located by JSON Pointer so a report can name the field. */
export interface SkinIssue {
  readonly path: string;
  readonly message: string;
}

export type SkinValidationResult =
  | { readonly ok: true; readonly skin: Skin }
  | { readonly ok: false; readonly issues: readonly SkinIssue[] };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const BASE_SIZE_PATTERN = /^(?:0\.8125|0\.875|0\.9375|1)rem$/;

const COLOR_TOKEN_NAME_SET: ReadonlySet<string> = new Set(SEMANTIC_COLOR_TOKEN_NAMES);
const FONT_STACK_ID_SET: ReadonlySet<string> = new Set(FONT_STACK_IDS);

/** Collects issues so one pass reports every violation, not just the first (§7.4 stage 2). */
class IssueLog {
  readonly issues: SkinIssue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Closed-object check. An unknown key is a rejection, never a silent drop. */
function rejectUnknownKeys(
  log: IssueLog,
  path: string,
  object: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const permitted = new Set<string>(allowed);
  for (const key of Object.keys(object)) {
    if (!permitted.has(key)) {
      log.add(`${path}/${key}`, "unknown property; this object accepts no additional properties");
    }
  }
}

function checkString(
  log: IssueLog,
  path: string,
  value: unknown,
  { min = 0, max }: { min?: number; max: number },
): void {
  if (typeof value !== "string") {
    log.add(path, "expected a string");
    return;
  }
  if (value.length < min) {
    log.add(path, `shorter than the minimum of ${min} characters`);
  }
  if (value.length > max) {
    log.add(path, `longer than the maximum of ${max} characters`);
  }
}

function checkEnum(log: IssueLog, path: string, value: unknown, allowed: readonly unknown[]): void {
  if (!allowed.includes(value)) {
    log.add(path, `expected one of: ${allowed.map((v) => JSON.stringify(v)).join(", ")}`);
  }
}

function checkAssetRef(log: IssueLog, path: string, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add(path, "expected an object with an `assetId`");
    return;
  }
  rejectUnknownKeys(log, path, value, ["assetId", "alt"]);
  if (typeof value.assetId !== "string" || !UUID_PATTERN.test(value.assetId)) {
    log.add(
      `${path}/assetId`,
      "expected a UUID referencing an asset in this tenant; a URL or data URI is not accepted",
    );
  }
  if (value.alt !== undefined) {
    checkString(log, `${path}/alt`, value.alt, { max: 120 });
  }
}

function checkMetadata(log: IssueLog, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add("/metadata", "expected an object");
    return;
  }
  rejectUnknownKeys(log, "/metadata", value, [
    "id",
    "name",
    "description",
    "author",
    "tenant",
    "createdAt",
    "updatedAt",
    "basedOn",
    "readOnly",
  ]);

  if (value.name === undefined) {
    log.add("/metadata/name", "required");
  } else {
    checkString(log, "/metadata/name", value.name, { min: 1, max: 60 });
  }

  if (value.createdAt === undefined) {
    log.add("/metadata/createdAt", "required");
  } else if (typeof value.createdAt !== "string" || !DATE_TIME_PATTERN.test(value.createdAt)) {
    log.add("/metadata/createdAt", "expected an RFC 3339 date-time");
  }

  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== "string" || !DATE_TIME_PATTERN.test(value.updatedAt)) {
      log.add("/metadata/updatedAt", "expected an RFC 3339 date-time");
    }
  }
  if (value.id !== undefined && (typeof value.id !== "string" || !UUID_PATTERN.test(value.id))) {
    log.add("/metadata/id", "expected a UUID");
  }
  if (value.description !== undefined) {
    checkString(log, "/metadata/description", value.description, { max: 280 });
  }
  if (value.author !== undefined) {
    checkString(log, "/metadata/author", value.author, { max: 120 });
  }
  if (value.tenant !== undefined) {
    checkString(log, "/metadata/tenant", value.tenant, { max: 60 });
  }
  if (value.basedOn !== undefined) {
    checkString(log, "/metadata/basedOn", value.basedOn, { max: 60 });
  }
  if (value.readOnly !== undefined && typeof value.readOnly !== "boolean") {
    log.add("/metadata/readOnly", "expected a boolean");
  }
}

function checkAssets(log: IssueLog, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add("/assets", "expected an object");
    return;
  }
  rejectUnknownKeys(log, "/assets", value, [
    "appTitle",
    "logoLight",
    "logoDark",
    "logoMark",
    "favicon",
  ]);
  if (value.appTitle !== undefined) {
    checkString(log, "/assets/appTitle", value.appTitle, { min: 1, max: 60 });
  }
  for (const key of ["logoLight", "logoDark", "logoMark", "favicon"] as const) {
    if (value[key] !== undefined) {
      checkAssetRef(log, `/assets/${key}`, value[key]);
    }
  }
}

function checkTypography(log: IssueLog, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add("/typography", "expected an object");
    return;
  }
  rejectUnknownKeys(log, "/typography", value, [
    "fontSans",
    "fontMono",
    "fontArabic",
    "baseSize",
    "scaleRatio",
    "baseWeight",
  ]);
  for (const key of ["fontSans", "fontMono", "fontArabic"] as const) {
    const ref = value[key];
    if (ref === undefined) continue;
    if (typeof ref !== "string" || !FONT_STACK_ID_SET.has(ref)) {
      log.add(
        `/typography/${key}`,
        "expected an allowlisted font stack id; a raw font-family string is not accepted",
      );
    }
  }
  if (value.baseSize !== undefined) {
    if (typeof value.baseSize !== "string" || !BASE_SIZE_PATTERN.test(value.baseSize)) {
      log.add("/typography/baseSize", "expected one of 0.8125rem, 0.875rem, 0.9375rem, 1rem");
    }
  }
  if (value.scaleRatio !== undefined) {
    const ratio = value.scaleRatio;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 1.1 || ratio > 1.333) {
      log.add("/typography/scaleRatio", "expected a number between 1.1 and 1.333");
    }
  }
  if (value.baseWeight !== undefined) {
    checkEnum(log, "/typography/baseWeight", value.baseWeight, [400, 500]);
  }
}

function checkGeometry(log: IssueLog, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add("/geometry", "expected an object");
    return;
  }
  rejectUnknownKeys(log, "/geometry", value, [
    "radiusRoot",
    "density",
    "shadowDepth",
    "sidebarStyle",
    "sidebarWidth",
  ]);
  if (value.radiusRoot !== undefined) {
    checkEnum(log, "/geometry/radiusRoot", value.radiusRoot, RADIUS_ROOT_STOPS);
  }
  if (value.density !== undefined) {
    checkEnum(log, "/geometry/density", value.density, ["compact", "comfortable"]);
  }
  if (value.shadowDepth !== undefined) {
    checkEnum(log, "/geometry/shadowDepth", value.shadowDepth, SHADOW_DEPTH_STOPS);
  }
  if (value.sidebarStyle !== undefined) {
    checkEnum(log, "/geometry/sidebarStyle", value.sidebarStyle, ["neutral", "brand", "contrast"]);
  }
  if (value.sidebarWidth !== undefined) {
    checkEnum(log, "/geometry/sidebarWidth", value.sidebarWidth, ["14rem", "16rem", "18rem"]);
  }
}

/**
 * The guard that stops an imported skin redefining a layer-1 primitive or
 * injecting an unknown property: any key not in the layer-2 colour catalogue is
 * rejected, and every value must match §7.2's narrow colour patterns.
 */
function checkTokens(log: IssueLog, value: unknown): void {
  if (!isPlainObject(value)) {
    log.add("/tokens", "expected an object");
    return;
  }
  for (const name of REQUIRED_SKIN_TOKENS) {
    if (value[name] === undefined) {
      log.add(`/tokens/${name}`, "required");
    }
  }
  for (const [key, raw] of Object.entries(value)) {
    if (!COLOR_TOKEN_NAME_SET.has(key)) {
      log.add(`/tokens/${key}`, "unknown token; a skin may set layer-2 semantic colour roles only");
      continue;
    }
    const valid = key === "overlay" ? isRgbAlphaColor(raw) : isHexColor(raw);
    if (!valid) {
      log.add(
        `/tokens/${key}`,
        key === "overlay"
          ? "expected `rgb(r g b / a)` with a two-decimal alpha"
          : "expected a 6-digit hex colour such as #1F6F5C",
      );
    }
  }
}

/**
 * §7.4 stage 2. Validates shape only: contrast is stage 5 (`checkContrast`) and
 * asset resolution is stage 3, both of which need context this function does
 * not have.
 */
export function validateSkin(input: unknown): SkinValidationResult {
  const log = new IssueLog();

  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ path: "", message: "expected a JSON object" }] };
  }

  rejectUnknownKeys(log, "", input, [
    "schemaVersion",
    "metadata",
    "mode",
    "direction",
    "assets",
    "typography",
    "geometry",
    "tokens",
  ]);

  if (input.schemaVersion === undefined) {
    log.add("/schemaVersion", "required");
  } else if (input.schemaVersion !== SKIN_SCHEMA_VERSION) {
    log.add(
      "/schemaVersion",
      `expected the integer ${SKIN_SCHEMA_VERSION}; an unknown version is rejected, never coerced`,
    );
  }

  if (input.metadata === undefined) {
    log.add("/metadata", "required");
  } else {
    checkMetadata(log, input.metadata);
  }

  if (input.mode === undefined) {
    log.add("/mode", "required");
  } else {
    checkEnum(log, "/mode", input.mode, ["light", "dark", "system"]);
  }

  if (input.direction === undefined) {
    log.add("/direction", "required");
  } else {
    checkEnum(log, "/direction", input.direction, ["ltr", "rtl", "locale"]);
  }

  if (input.assets !== undefined) checkAssets(log, input.assets);
  if (input.typography !== undefined) checkTypography(log, input.typography);
  if (input.geometry !== undefined) checkGeometry(log, input.geometry);

  if (input.tokens === undefined) {
    log.add("/tokens", "required");
  } else {
    checkTokens(log, input.tokens);
  }

  if (log.issues.length > 0) {
    return { ok: false, issues: log.issues };
  }
  // Every field has been checked against the schema above, so the narrowing is
  // earned rather than asserted away.
  return { ok: true, skin: input as unknown as Skin };
}

/** Nesting depth of a parsed JSON value, for stage 1's depth limit. */
function jsonDepth(value: unknown, depth = 1): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, jsonDepth(item, depth + 1)), depth);
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce<number>(
      (max, item) => Math.max(max, jsonDepth(item, depth + 1)),
      depth,
    );
  }
  return depth;
}

/**
 * §7.4 stages 1 and 2 together — the entry point for an imported file.
 *
 * The size and depth limits come before parsing intent: a 5 MB document or a
 * 40-deep object is refused as a file, so no hostile-size payload is walked.
 */
export function parseSkinDocument(text: string): SkinValidationResult {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SKIN_BYTES) {
    return {
      ok: false,
      issues: [{ path: "", message: `larger than the ${MAX_SKIN_BYTES}-byte limit` }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "", message: "this file is not a valid skin" }] };
  }

  if (jsonDepth(parsed) > MAX_SKIN_DEPTH) {
    return {
      ok: false,
      issues: [{ path: "", message: `nested deeper than the limit of ${MAX_SKIN_DEPTH}` }],
    };
  }

  return validateSkin(parsed);
}

/** The mode a skin's values are resolved against. `system` is decided by the request (§9.4). */
export function resolveSkinMode(skin: Skin, prefersDark: boolean): ColorMode {
  if (skin.mode === "system") {
    return prefersDark ? "dark" : "light";
  }
  return skin.mode;
}

/**
 * §7.4 stage 4. Missing optional tokens are filled from the system default for
 * the declared mode — never from the tenant's current theme, which would make
 * an import's result depend on hidden state.
 */
export function resolveSkinTokens(skin: Skin, mode: ColorMode): SemanticColorTokens {
  return { ...semanticColors[mode], ...skin.tokens };
}

/**
 * The custom properties a skin contributes: its 66 colour roles plus the
 * typography, geometry and layer-3 values the Appearance module exposes.
 *
 * `geometry.density` is deliberately absent — it is applied as `data-density`
 * on `<html>` (§4.7), and an attribute rule outranks `:root`, so emitting it
 * here would produce a declaration that is silently ignored.
 */
export function skinTokenDeclarations(skin: Skin, mode: ColorMode): Record<string, string> {
  const declarations: Record<string, string> = { ...resolveSkinTokens(skin, mode) };

  const { typography, geometry } = skin;
  if (typography?.fontSans) declarations.fontSans = fontStacks[typography.fontSans];
  if (typography?.fontMono) declarations.fontMono = fontStacks[typography.fontMono];
  if (typography?.fontArabic) declarations.fontArabic = fontStacks[typography.fontArabic];
  if (typography?.baseSize) declarations.fontSizeBase = typography.baseSize;
  if (typography?.scaleRatio !== undefined) {
    declarations.fontScaleRatio = String(typography.scaleRatio);
  }
  // FR-THEME-05's "weight" control. `--font-weight-regular` is the only weight
  // token a base weight can mean; the rest of the ramp is fixed (§4.6).
  if (typography?.baseWeight !== undefined) {
    declarations.fontWeightRegular = String(typography.baseWeight);
  }

  if (geometry?.radiusRoot) declarations.radiusRoot = geometry.radiusRoot;
  if (geometry?.shadowDepth !== undefined) declarations.shadowDepth = String(geometry.shadowDepth);
  if (geometry?.sidebarWidth) declarations.sidebarWidth = geometry.sidebarWidth;
  if (geometry?.sidebarStyle) declarations.sidebarStyle = `"${geometry.sidebarStyle}"`;

  return declarations;
}

/**
 * The `<style id="shj3-theme">` body for a resolved skin.
 *
 * Every value passes `css.ts`'s emit-time validation again here, which is the
 * defence-in-depth §9.4 requires: a row written by an older build, a migration
 * or a direct database edit still cannot inject CSS.
 */
export function serializeSkin(skin: Skin, mode: ColorMode, options: SerializeOptions = {}): string {
  return serializeTokens(skinTokenDeclarations(skin, mode), options);
}
