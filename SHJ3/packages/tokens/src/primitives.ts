/**
 * Layer 1 — design primitives (`design-system.md` §3.3, ADR-0007's token contract).
 *
 * Raw values. This is the only file in the repository that is *supposed* to
 * contain colour literals; every other module resolves through the semantic
 * layer, and the token gate (`scripts/gates/no-hardcoded-design-values.mjs`)
 * enforces that by allowlisting `packages/tokens/` and nothing else.
 *
 * Two properties of this layer are load-bearing rather than stylistic:
 *
 *  1. **Feature code may never reference a primitive.** A primitive is a value
 *     decision; feature code is only allowed role decisions (§2 P2). The
 *     `shj3-` prefix exists so that a primitive reference is visible to a
 *     reader as well as to lint.
 *  2. **A skin never contains layer 1** (§3.1). If an imported skin could
 *     redefine `--shj3-green-600`, it would silently mutate the meaning of
 *     every semantic token derived from it — including `--success`, which
 *     §4.3 deliberately decouples from `--primary` so that re-branding cannot
 *     turn a `Healthy` badge into another colour's meaning.
 *
 * The catalogue is exactly the 22 primitives §3.3 publishes. §4's semantic
 * catalogue introduces further literals (the warning and info hues, the
 * chart-6 violet, and most dark-mode values) that §3.3 does not lift into
 * layer 1; those live in `semantic.ts` where the document puts them.
 */

/**
 * The 22 layer-1 primitives. Keys are camelCase; the CSS custom property is
 * derived mechanically as `--shj3-<kebab-key>` (`sand100` → `--shj3-sand-100`),
 * so the naming rule in §3.2 is a function of the key rather than a second list
 * that can drift from it.
 */
export const primitives = {
  // Neutral / paper family — wireframe §7.2.
  paper: "#F6F5F1",
  panel: "#FFFFFF",
  sand100: "#EFEDE7",
  sand200: "#E3E1DA",
  sand400: "#8F8B81",
  ink900: "#20242B",
  ink500: "#5B6270",

  // Brand green family. `green600` is the wireframe accent.
  green800: "#15584A",
  green600: "#1F6F5C",
  green300: "#8FD9C2",
  green100: "#DDEDE7",

  // Rust family. `rust600` is the wireframe "warn" colour, and §6.3's finding
  // about it — 4.46:1 as text on paper — is why `rust700` exists at all.
  rust700: "#9E4230",
  rust600: "#B4553F",
  rust100: "#F5E3DD",

  // Dark-mode neutrals. Desaturated blue-slate rather than black: pure black
  // behind a 14px UI produces halation (§8.2).
  slate950: "#14171C",
  slate900: "#1B1F26",
  slate800: "#232830",
  slate600: "#6A7280",
  slate200: "#A2A9B5",
  slate050: "#EDEEF0",

  // Geometry. Both are the root of a derived scale rather than a value used
  // directly, which is why they are primitives and not semantic tokens.
  spaceUnit: "0.25rem",
  radiusUnit: "0.5rem",
} as const;

export type PrimitiveTokenName = keyof typeof primitives;

/** Prefix carried by every layer-1 custom property, and only by layer 1 (§3.2 rule 1). */
export const PRIMITIVE_PREFIX = "shj3-";

export const PRIMITIVE_TOKEN_NAMES = Object.keys(primitives) as readonly PrimitiveTokenName[];
