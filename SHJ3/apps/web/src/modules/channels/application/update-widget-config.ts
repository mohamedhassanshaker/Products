import { buildWidgetEmbedSnippet } from "../domain/embed-snippet.js";
import type { LauncherPosition, WidgetDefaultState } from "../domain/vocabulary.js";
import type { WidgetConfigRepository } from "../ports/widget-config-repository.js";

export interface UpdateWidgetConfigInput {
  readonly channelId: string;
  readonly accentTokenKey: string;
  readonly launcherPosition: LauncherPosition;
  readonly defaultState: WidgetDefaultState;
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly showDisclaimerDismiss: boolean;
  readonly tenantSlug: string;
  readonly scriptOrigin: string;
  readonly now: Date;
}

export interface UpdateWidgetConfigResult {
  readonly embedSnippet: string;
  readonly embedSnippetVersion: number;
}

/**
 * `PUT /channels/web-widget` (B10 tab 2). `accentTokenKey` is a design-token key resolved by
 * the caller from the closed 5-swatch set (`--chart-1`..`--chart-5`, `@shj3/tokens`) — never a
 * hex literal (`CK_WidgetConfigs_accentIsToken`). Contrast validation is intentionally not
 * repeated here: all 5 offered swatches are pre-vetted system semantic-colour tokens that
 * `@shj3/tokens`' own contrast suite already asserts against the surfaces they pair with, so
 * there is no free-form colour input this screen could produce that the design system has not
 * already checked — unlike Phase E's tenant-branding editor, which validates arbitrary
 * admin-entered hex and is a different, already-built module.
 *
 * "PUT returns the recomputed embed snippet, so the live preview and the snippet cannot
 * disagree" — the repository bumps `embedSnippetVersion` on every save; this use case
 * recomputes the snippet string fresh from the just-saved config on the same response.
 */
export class UpdateWidgetConfig {
  constructor(private readonly deps: { readonly widgetConfig: WidgetConfigRepository }) {}

  async execute(input: UpdateWidgetConfigInput): Promise<UpdateWidgetConfigResult> {
    const saved = await this.deps.widgetConfig.update({
      channelId: input.channelId,
      accentTokenKey: input.accentTokenKey,
      launcherPosition: input.launcherPosition,
      defaultState: input.defaultState,
      disclaimerText: input.disclaimerText,
      greetingText: input.greetingText,
      composerPlaceholder: input.composerPlaceholder,
      showDisclaimerDismiss: input.showDisclaimerDismiss,
      now: input.now,
    });

    return {
      embedSnippet: buildWidgetEmbedSnippet({
        tenantSlug: input.tenantSlug,
        scriptOrigin: input.scriptOrigin,
      }),
      embedSnippetVersion: saved.embedSnippetVersion,
    };
  }
}
