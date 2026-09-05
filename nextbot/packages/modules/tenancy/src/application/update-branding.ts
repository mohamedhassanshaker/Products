import type { TenantBranding } from "@nextbot/contracts";
import { BrandingContrastInsufficientError } from "@nextbot/contracts";
import { checkContrastRatio } from "../domain/contrast-checker.js";
import { updateTenantBranding } from "./tenant-branding.js";

/** The widget's own hardcoded header/launcher text color (`apps/widget-embed/src/
 * widget/components/WidgetWindow.tsx`'s header `color="white"`, `TextBubble.tsx`'s
 * customer-bubble text) — the *only* text-on-brand-color pairing this product
 * actually ever renders. */
const WIDGET_TEXT_COLOR = "#FFFFFF";

/**
 * FR-ADM-07: validates a brand color's contrast before persisting it as the
 * tenant's *default*.
 *
 * **D5 fix (QA fix pass):** this now checks exactly one pairing — white text on
 * the brand color — because that is the *only* pairing the widget's rendering
 * code actually ever produces (its header/launcher text color is hardcoded white,
 * never switched to a dark color based on the brand fill). The prior version
 * checked white-or-dark-text and accepted the color if *either* passed, which
 * only rejects a narrow mid-gray dead zone; a washed-out near-white color (e.g.
 * `#f5f5f5`) trivially passes the *dark*-text half of that check and sailed
 * through with no warning, even though the widget only ever renders *white* text
 * on it — producing an illegible white-on-near-white widget in production. The
 * gate must validate against how the color is actually used, not a
 * context-independent "is there some legible text color" question the widget
 * never actually asks.
 *
 * **Locally-reversible interpretation note (flagged, not a structural decision,
 * revised from this function's earlier version):** the spec's literal phrase is
 * "against both light and dark surface backgrounds," and an even earlier version
 * of this function checked the brand color as an accent against light/dark *page*
 * backgrounds at 3:1 (found unsatisfiable for realistic brand colors). This
 * version anchors the check to the spec's own worked example — "button text on
 * primary-color background" — and to this specific product's actual rendering
 * behavior (always-white text), rather than a hypothetical dual-text-color system
 * this codebase doesn't implement.
 *
 * @throws {BrandingContrastInsufficientError} naming the first failing field —
 *   blocks saving as a default outright; there is no "save anyway" override for
 *   this screen (that override exists only for a host-page-level per-embed widget
 *   override, a surface this Admin Console screen does not configure).
 */
export async function updateBranding(
  tenantId: string,
  input: { branding: TenantBranding; whiteLabelEnabled?: boolean },
): Promise<void> {
  validateColorField("primaryColor", input.branding.primaryColor);
  validateColorField("secondaryColor", input.branding.secondaryColor);

  await updateTenantBranding(tenantId, { brandingConfig: input.branding, whiteLabelEnabled: input.whiteLabelEnabled });
}

function validateColorField(field: "primaryColor" | "secondaryColor", color: string): void {
  const withWidgetText = checkContrastRatio(WIDGET_TEXT_COLOR, color);
  if (!withWidgetText.passesAA) {
    throw new BrandingContrastInsufficientError(
      field,
      `the widget's white header/launcher text (ratio ${withWidgetText.ratio}:1, needs 4.5:1)`,
    );
  }
}
