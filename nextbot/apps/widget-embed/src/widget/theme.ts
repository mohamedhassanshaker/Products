import { checkContrastRatio } from "./branding/contrast-checker.js";

/**
 * The widget's own, standalone brand-style mechanism (Plan Phase 5,
 * `docs/plans/chakra-to-shadcn-plan.md` — supersedes the Chakra `extendTheme`
 * instance this file used to export; see ADR-0010). Instead of re-instantiating a
 * whole theme object, this now mirrors `apps/web/src/lib/build-brand-style-tag.ts`'s
 * CSS-custom-property `<style>`-injection pattern: the *only* two tokens a tenant's
 * brand color ever overrides are `--primary`/`--primary-foreground` (see
 * `globals.css`'s token-contract comment). `WidgetApp.tsx` renders the resulting
 * string as a literal `<style>` child (no `dangerouslySetInnerHTML` needed — this
 * is a plain client-rendered React tree, not SSR) before the rest of the widget,
 * so the tenant's brand color is applied before first paint, same as before.
 *
 * Every color is a resolved token, never a hard-coded hex in a component — the
 * FR-ADM-07 brand profile (merged with any per-embed override, see
 * `@nextbot/conversations`'s `mergeWidgetConfigWithBranding`) is the *only* input
 * to `--primary` below, same guarantee the old Chakra-era theme documented.
 */
export interface WidgetThemeInput {
  primaryColor?: string;
  fontFamily?: string;
}

/** Matches the same hex pattern `TenantBrandingSchema`/`build-brand-style-tag.ts`
 * validate against — re-checked here defensively before string-interpolating into
 * a literal `<style>` tag body, since a malformed/legacy row (or a directly-crafted
 * `NextBot.init({ theme: { primaryColor: "..." } })` call from a host page) must
 * never be able to inject arbitrary CSS or break out of the `<style>` element. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Matches the prior Chakra-era `DEFAULT_PRIMARY` so an unbranded/default-themed
 * embed looks the same as it did before this migration. */
const DEFAULT_PRIMARY = "#4f46e5";

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Picks whichever of white/black clears (or comes closer to clearing) the WCAG AA
 * contrast minimum against `background` — same tie-break logic as `apps/web`'s
 * `build-brand-style-tag.ts`, using this package's own duplicated
 * `checkContrastRatio` (see `branding/contrast-checker.ts`'s doc comment for why
 * it's a duplicate, not a shared import). */
function pickForegroundForContrast(background: string): string {
  const whiteResult = checkContrastRatio(WHITE, background);
  const blackResult = checkContrastRatio(BLACK, background);
  if (whiteResult.passesAA && !blackResult.passesAA) return WHITE;
  if (blackResult.passesAA && !whiteResult.passesAA) return BLACK;
  return whiteResult.ratio >= blackResult.ratio ? WHITE : BLACK;
}

/**
 * Builds the literal `:root { --primary; --primary-foreground; }` CSS text this
 * widget injects via a client-rendered `<style>` element in `WidgetApp.tsx`.
 *
 * @param input the merged tenant-brand-profile + per-embed-override theme input
 *   (`WidgetApp.tsx` already resolves the "per-embed config wins over the tenant
 *   default" precedence before calling this — see the D4 fix's doc comment there).
 */
export function buildWidgetBrandStyleTag(input: WidgetThemeInput = {}): string {
  const primary = input.primaryColor && HEX_COLOR_RE.test(input.primaryColor) ? input.primaryColor : DEFAULT_PRIMARY;
  const primaryForeground = pickForegroundForContrast(primary);
  return `:root{--primary:${primary};--primary-foreground:${primaryForeground};}`;
}
