/**
 * `@shj3/tokens` — the design token system (`docs/design-system.md`, ADR-0007).
 *
 * The three token layers, the skin format and its validator, the CSS emitter
 * used for server-side theme injection, and the WCAG 2.1 AA contrast gate.
 *
 * This package is the one place in the repository where raw design values are
 * permitted; the token gate allowlists `packages/tokens/` and nothing else, so
 * every other module — feature code, components, the Tailwind config — consumes
 * these exports rather than restating a value (§1.2, §12.1).
 *
 * Layer 1 is exported for the emitter and the Tailwind config only. Feature
 * code importing a primitive is a lint failure (§12.3), and the reason is not
 * tidiness: a primitive is a value decision, and a value cannot be re-pointed
 * by a tenant.
 */

export {
  PRIMITIVE_PREFIX,
  PRIMITIVE_TOKEN_NAMES,
  primitives,
  type PrimitiveTokenName,
} from "./primitives.js";

export {
  ALPHA_COLOR_TOKEN_NAMES,
  breakpoints,
  DENSITY_SCALE,
  FONT_STACK_IDS,
  fontStacks,
  motion,
  RADIUS_ROOT_STOPS,
  radius,
  REDUCED_MOTION_OVERRIDES,
  SEMANTIC_COLOR_TOKEN_NAMES,
  SEMANTIC_TOKEN_NAMES,
  SHADOW_COLOR_BY_MODE,
  SHADOW_DEPTH_STOPS,
  semanticColors,
  semanticTokens,
  shadow,
  spacing,
  typography,
  zIndex,
  type ColorMode,
  type FontStackRef,
  type SemanticColorTokenName,
  type SemanticColorTokens,
  type SemanticTokenSet,
} from "./semantic.js";

export {
  COMPONENT_TOKEN_NAMES,
  componentTokens,
  SKINNABLE_COMPONENT_TOKENS,
  type ComponentTokenName,
  type SkinnableComponentTokenName,
} from "./components.js";

export { generateTailwindThemeCss } from "./tailwind-theme.js";

export {
  assertSafeCssValue,
  EMITTABLE_TOKEN_NAMES,
  HEX_COLOR_PATTERN,
  isHexColor,
  isRgbAlphaColor,
  RGB_ALPHA_COLOR_PATTERN,
  serializeBaseStylesheet,
  serializeComponentLayer,
  serializePrimitiveLayer,
  serializeSemanticLayer,
  serializeTokens,
  THEME_STYLE_ELEMENT_ID,
  toCssCustomPropertyName,
  UnknownTokenError,
  UnsafeTokenValueError,
  type SerializeOptions,
} from "./css.js";

export {
  MAX_SKIN_BYTES,
  MAX_SKIN_DEPTH,
  parseSkinDocument,
  REQUIRED_SKIN_TOKENS,
  resolveSkinMode,
  resolveSkinTokens,
  serializeSkin,
  SKIN_SCHEMA_VERSION,
  skinTokenDeclarations,
  validateSkin,
  type RequiredSkinTokenName,
  type SidebarStyle,
  type Skin,
  type SkinAssetRef,
  type SkinAssets,
  type SkinDensity,
  type SkinDirection,
  type SkinGeometry,
  type SkinIssue,
  type SkinMetadata,
  type SkinMode,
  type SkinTokens,
  type SkinTypography,
  type SkinValidationResult,
} from "./skin.js";

export {
  AA_LARGE_TEXT_RATIO,
  AA_NON_TEXT_RATIO,
  AA_TEXT_RATIO,
  checkContrast,
  contrastRatio,
  CONTRAST_EXEMPTIONS,
  CONTRAST_PAIRS,
  EXEMPT_COLOR_TOKENS,
  InvalidColorError,
  isBlocking,
  relativeLuminance,
  roundRatio,
  thresholdFor,
  type ContrastCheck,
  type ContrastPair,
  type ContrastPairClass,
  type ContrastReport,
} from "./contrast.js";

export { CONTRAST_EXEMPT_PAIRS } from "./contrast-pairs.js";

export { SHARJAH_DARK, SHARJAH_DEFAULT, SHIPPED_SKINS, systemSkin } from "./skins/index.js";
