"use client";

/**
 * B10 tab 2 — Web widget studio. Live preview via the REAL shared
 * `modules/conversation/adapters/inbound/widget-preview-shell.tsx` (built in parallel by the
 * conversation-module wave; its real shape matched what this module expected —
 * `{accentColor, launcherPosition, defaultState, disclaimerText, greetingText,
 * composerPlaceholder, suggestionChips}`, a default export — so this tab imports it directly
 * rather than the inline fallback the brief allowed for if it hadn't landed yet).
 *
 * `accentTokenKey` (`WidgetConfig`'s own persisted value, e.g. `--chart-1`) is resolved to an
 * actual colour here, client-side, purely for the preview's own `accentColor` prop —
 * `@shj3/tokens`'s `semanticTokens(mode)` is the same resolution mechanism the rest of the
 * design system uses (grepped before writing this: `chart1`..`chart5` is a real, already
 * hue-separated, already contrast-vetted 5-colour series — `packages/tokens/src/semantic.ts`
 * §4's own "ordered by hue separation... every series clears 4.5:1 on card"). The persisted
 * value itself never becomes a hex literal (`CK_WidgetConfigs_accentIsToken`).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { primitives, semanticTokens } from "@shj3/tokens";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { WidgetStudioSnapshot } from "../../../../modules/channels/application/get-widget-studio.js";
import type {
  LauncherPosition,
  WidgetDefaultState,
} from "../../../../modules/channels/domain/vocabulary.js";
import type { ChannelsScreenActions } from "./channels-screen.js";

// A client-only dynamic import: the preview composes chat organisms with no SSR need here,
// and this keeps this tab's own bundle boundary explicit.
const WidgetPreviewShell = dynamic(
  () => import("../../../../modules/conversation/adapters/inbound/widget-preview-shell.js"),
  { ssr: false },
);

const ACCENT_SWATCHES = [
  { tokenKey: "--chart-1", semanticKey: "chart1" as const },
  { tokenKey: "--chart-2", semanticKey: "chart2" as const },
  { tokenKey: "--chart-3", semanticKey: "chart3" as const },
  { tokenKey: "--chart-4", semanticKey: "chart4" as const },
  { tokenKey: "--chart-5", semanticKey: "chart5" as const },
] as const;

function resolveAccentColor(tokenKey: string): string {
  const swatch = ACCENT_SWATCHES.find((s) => s.tokenKey === tokenKey);
  const tokens = semanticTokens("light");
  const resolved = swatch ? tokens[swatch.semanticKey] : tokens.chart1;
  // `chart1`'s own real value (packages/tokens/src/semantic.ts: `chart1: p.green600`) —
  // a token reference, not a restated literal — for the type-level "possibly undefined"
  // case an indexed access produces even though every `ACCENT_SWATCHES` key is real.
  return resolved ?? tokens.chart1 ?? primitives.green600;
}

export interface WidgetStudioTabProps {
  readonly channelId: string;
  readonly studio: WidgetStudioSnapshot;
  readonly tenantSlug: string;
  readonly actions: ChannelsScreenActions;
}

export function WidgetStudioTab({
  channelId,
  studio,
  tenantSlug,
  actions,
}: WidgetStudioTabProps): React.ReactElement {
  const t = useTranslations("channels.widgetStudio");
  const router = useRouter();
  const locale = useLocale();

  const [accentTokenKey, setAccentTokenKey] = React.useState(studio.config.accentTokenKey);
  const [launcherPosition, setLauncherPosition] = React.useState<LauncherPosition>(
    studio.config.launcherPosition,
  );
  const [defaultState, setDefaultState] = React.useState<WidgetDefaultState>(
    studio.config.defaultState,
  );
  const [disclaimerText, setDisclaimerText] = React.useState(studio.config.disclaimerText);
  const [greetingText, setGreetingText] = React.useState(studio.config.greetingText);
  const [composerPlaceholder, setComposerPlaceholder] = React.useState(
    studio.config.composerPlaceholder,
  );
  const [showDisclaimerDismiss, setShowDisclaimerDismiss] = React.useState(
    studio.config.showDisclaimerDismiss,
  );
  const [embedSnippet, setEmbedSnippet] = React.useState(studio.embedSnippet);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [newDomain, setNewDomain] = React.useState("");
  const [domainError, setDomainError] = React.useState<string | null>(null);
  const showDismissId = React.useId();

  async function handleSave(): Promise<void> {
    setPending(true);
    setError(null);
    const result = await actions.updateWidgetConfig({
      channelId,
      accentTokenKey,
      launcherPosition,
      defaultState,
      disclaimerText,
      greetingText,
      composerPlaceholder,
      showDisclaimerDismiss,
      tenantSlug,
      scriptOrigin: window.location.origin,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEmbedSnippet(result.value.embedSnippet);
    router.refresh();
  }

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddDomain(): Promise<void> {
    setDomainError(null);
    const result = await actions.addWidgetAllowedDomain({ channelId, domain: newDomain });
    if (!result.ok) {
      setDomainError(result.error);
      return;
    }
    if (!result.value.ok) {
      setDomainError(t("domainInvalidError"));
      return;
    }
    setNewDomain("");
    router.refresh();
  }

  async function handleRemoveDomain(domain: string): Promise<void> {
    setDomainError(null);
    const result = await actions.removeWidgetAllowedDomain({ channelId, domain });
    if (!result.ok) {
      setDomainError(result.error);
      return;
    }
    if (!result.value.ok) {
      setDomainError(t("domainAllowlistEmptyWhileLiveError"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        {error ? <InlineAlert variant="destructive">{error}</InlineAlert> : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">{t("fieldAccentColor")}</legend>
          <div className="flex gap-2">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch.tokenKey}
                type="button"
                aria-label={swatch.tokenKey}
                aria-pressed={accentTokenKey === swatch.tokenKey}
                onClick={() => setAccentTokenKey(swatch.tokenKey)}
                className="size-8 rounded-full border-2 outline-none focus-visible:outline focus-visible:outline-ring"
                style={{
                  backgroundColor: resolveAccentColor(swatch.tokenKey),
                  borderColor:
                    accentTokenKey === swatch.tokenKey ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </fieldset>

        <FormField label={t("fieldLauncherPosition")}>
          {(field) => (
            <select
              {...field}
              value={launcherPosition}
              onChange={(event) => setLauncherPosition(event.target.value as LauncherPosition)}
              className="rounded-xs border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="BottomRight">{t("launcherBottomRight")}</option>
              <option value="BottomLeft">{t("launcherBottomLeft")}</option>
            </select>
          )}
        </FormField>

        <FormField label={t("fieldDefaultState")}>
          {(field) => (
            <select
              {...field}
              value={defaultState}
              onChange={(event) => setDefaultState(event.target.value as WidgetDefaultState)}
              className="rounded-xs border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="Docked">{t("stateDocked")}</option>
              <option value="Expanded">{t("stateExpanded")}</option>
            </select>
          )}
        </FormField>

        <FormField label={t("fieldDisclaimerText")}>
          {(field) => (
            <Textarea
              {...field}
              value={disclaimerText}
              onChange={(event) => setDisclaimerText(event.target.value)}
            />
          )}
        </FormField>

        <FormField label={t("fieldGreetingText")}>
          {(field) => (
            <Textarea
              {...field}
              value={greetingText}
              onChange={(event) => setGreetingText(event.target.value)}
            />
          )}
        </FormField>

        <FormField label={t("fieldComposerPlaceholder")}>
          {(field) => (
            <Input
              {...field}
              value={composerPlaceholder}
              onChange={(event) => setComposerPlaceholder(event.target.value)}
            />
          )}
        </FormField>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={showDismissId}>{t("fieldShowDisclaimerDismiss")}</Label>
          <Switch
            id={showDismissId}
            checked={showDisclaimerDismiss}
            onCheckedChange={setShowDisclaimerDismiss}
          />
        </div>

        <div>
          <Button type="button" loading={pending} onClick={() => void handleSave()}>
            {t("saveAction")}
          </Button>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">{t("allowedDomainsHeading")}</h3>
          {domainError ? <InlineAlert variant="destructive">{domainError}</InlineAlert> : null}
          <ul className="flex flex-wrap gap-2">
            {studio.allowedDomains.map((domain) => (
              <li
                key={domain.id}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm"
              >
                {domain.domain}
                <button
                  type="button"
                  aria-label={t("removeDomainAction", { domain: domain.domain })}
                  onClick={() => void handleRemoveDomain(domain.domain)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              placeholder={t("newDomainPlaceholder")}
              dir="ltr"
            />
            <Button type="button" variant="outline" onClick={() => void handleAddDomain()}>
              {t("addDomainAction")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">{t("embedSnippetHeading")}</h3>
          <pre className="overflow-x-auto rounded-xs bg-muted p-3 text-xs" dir="ltr">
            <code>{embedSnippet}</code>
          </pre>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {t("copyAction")}
            </Button>
            <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
              {copied ? t("copiedConfirmation") : ""}
            </span>
          </div>
          {
            // 2026-09-10 stakeholder review, Issue 3: a copy-pasted snippet opened directly
            // as a local `file://` page always fails (a real, correct security behaviour —
            // `Origin: null` is never on any channel's allowed-domains list, and that check
            // must not be weakened). The honest fix is pointing at the real, same-origin,
            // no-allowlist-needed demo page (`/{locale}/widget`, built by the B-6 wave) that
            // exercises this exact tenant/channel's real widget end to end.
          }
          <Button asChild type="button" variant="outline" size="sm">
            <a
              href={`/${locale}/widget?channelKey=${encodeURIComponent(`${tenantSlug}.WebWidget`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openLivePreviewAction")}
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">{t("openLivePreviewHelp")}</p>
        </div>
      </div>

      <div className="rounded-md border border-border p-2">
        <WidgetPreviewShell
          accentColor={resolveAccentColor(accentTokenKey)}
          launcherPosition={launcherPosition}
          defaultState={defaultState}
          disclaimerText={disclaimerText}
          greetingText={greetingText}
          composerPlaceholder={composerPlaceholder}
          suggestionChips={[]}
        />
      </div>
    </div>
  );
}
