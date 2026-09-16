/**
 * The content lookup table — one module per `GuideRegistryEntry.slug`, each exporting both
 * locales together (see `domain/guide-content.ts`'s module comment on why: colocating EN/AR
 * in one file is what makes "both locales updated in the same edit" the path of least
 * resistance, rather than a discipline two separate directories rely on authors remembering).
 *
 * A slug containing `/` (`"agents/wizard"`, `"settings/appearance"`) maps to a filename with
 * `/` replaced by `-` — plain, boring, and exactly what `CONTENT_BY_SLUG`'s keys below make
 * explicit and typo-checkable at a glance.
 */
import type { GuideLocale, GuidePageContent } from "../domain/guide-content.js";
import { commandCentre } from "./command-centre.js";
import { agents } from "./agents.js";
import { agentsWizard } from "./agents-wizard.js";
import { agentsNewWithAi } from "./agents-new-with-ai.js";
import { aiSettings } from "./ai-settings.js";
import { tools } from "./tools.js";
import { orchestrator } from "./orchestrator.js";
import { knowledge } from "./knowledge.js";
import { iam } from "./iam.js";
import { channels } from "./channels.js";
import { escalations } from "./escalations.js";
import { identity } from "./identity.js";
import { evaluation } from "./evaluation.js";
import { governance } from "./governance.js";
import { guardrails } from "./guardrails.js";
import { settingsAppearance } from "./settings-appearance.js";
import { settingsAppearanceReset } from "./settings-appearance-reset.js";
import { signIn } from "./sign-in.js";
import { citizenWidget } from "./citizen-widget.js";
import { tenants } from "./tenants.js";
import { branding } from "./branding.js";
import { brandingReset } from "./branding-reset.js";

export type LocalizedGuideContent = Readonly<Record<GuideLocale, GuidePageContent>>;

/** Keys must exactly match `GUIDE_REGISTRY`'s `slug` values — the coverage gate does not check this file directly, but `application/get-guide-entry.test.ts` does, against the real registry. */
export const CONTENT_BY_SLUG: Readonly<Record<string, LocalizedGuideContent>> = {
  "command-centre": commandCentre,
  agents,
  "agents/wizard": agentsWizard,
  "agents/new-with-ai": agentsNewWithAi,
  "ai-settings": aiSettings,
  tools,
  orchestrator,
  knowledge,
  iam,
  channels,
  escalations,
  identity,
  evaluation,
  governance,
  guardrails,
  "settings/appearance": settingsAppearance,
  "settings/appearance/reset": settingsAppearanceReset,
  "sign-in": signIn,
  "citizen-widget": citizenWidget,
  tenants,
  branding,
  "branding/reset": brandingReset,
};
