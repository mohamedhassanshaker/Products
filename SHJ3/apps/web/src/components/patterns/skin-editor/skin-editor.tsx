"use client";

/**
 * `SkinEditor` — design-system.md §5.5 #55, the Settings -> Appearance screen's
 * organism. §9.1's two-pane layout (a `SubTabBar` of five control sections at
 * inline-start, the live preview at inline-end) and §9.2's never-half-applied rules,
 * built against the REAL, already-built backend surface (`manage-appearance.ts`,
 * `appearance-gate.ts`, `packages/tokens/src/skin.ts`) — never a second,
 * parallel implementation of validation, contrast-gating or the skin schema.
 *
 * This file owns no knowledge of Prisma, permissions, or `modules/theming` — the
 * component-library boundary (`eslint.config.mjs`) restricts `components/**` to
 * depending on `components`/`shared` only. Every persistence/permission concern
 * arrives as a prop (`actions.*`, `canManageTenantAppearance`); the Settings ->
 * Appearance route (`app/[locale]/settings/appearance/page.tsx`) is what wires those
 * props to the real repository and permission check.
 *
 * ## The six never-half-applied rules (§9.2), and where each one actually lives
 *
 * 1. **Atomic save** — `handleSave` calls `actions.saveTenantAppearance` exactly
 *    once with the WHOLE candidate (both modes' colours + every branding scalar);
 *    there is no per-field save call anywhere in this file.
 * 2. **Blocked, not warned, on contrast failure** — `saveResult.ok === false` renders
 *    `combineContrastFailures`'s real, computed failures via `SummaryStrip`'s
 *    `blocking` variant, and the Save button stays available (nothing was written)
 *    rather than silently "succeeding" with a warning.
 * 3. **Discard reverts by closure** — `useSkinCandidate.discard()` reverts colours
 *    from its own in-memory baseline (proven in `use-skin-candidate.test.ts`); the
 *    scalar baseline below mirrors the identical pattern for name/description/
 *    branding/personal fields. Neither ever refetches from the server.
 * 4. **Navigation-away guard** — a real `beforeunload` listener while `isDirty`
 *    (covers browser back/forward/reload/close) plus an intercepted click on this
 *    page's own "Reset to default" link. Honest scope note: App Router navigation
 *    via the global `AppShell` sidebar is NOT intercepted by this component — a
 *    page-agnostic navigation-guard belongs to `AppShell` itself, a different,
 *    already-built organism this wave does not touch (see `tasks/todo.md`'s review
 *    entry for the full reasoning).
 * 5. **Reset to default always available** — the `resetHref` link to the real,
 *    already-built `/settings/appearance/reset` route, not rebuilt here.
 * 6. **Mode independence** — `useSkinCandidate` (see that file's own doc comment and
 *    tests); `editingMode` only ever selects WHICH mode's colours the controls
 *    pane/preview currently show, never which mode's edits exist.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import type {
  ContrastReport,
  SemanticColorTokenName,
  SemanticColorTokens,
  SkinIssue,
} from "@shj3/tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/patterns/dialog";
import { applyCandidate } from "./apply-candidate.js";
import { BrandSection } from "./brand-section.js";
import { SemanticSection } from "./semantic-section.js";
import { TypographySection } from "./typography-section.js";
import { LayoutSection } from "./layout-section.js";
import { ModeDirectionSection } from "./mode-direction-section.js";
import { SkinManager } from "./skin-manager.js";
import { SkinPreview } from "./skin-preview.js";
import { combineContrastFailures } from "./contrast-report-to-conditions.js";
import { useSkinCandidate } from "./use-skin-candidate.js";
import type {
  SkinEditorBrandAssetKind,
  SkinEditorBrandAssets,
  SkinEditorBrandingScalars,
  SkinEditorDeletionResult,
  SkinEditorDirection,
  SkinEditorFontSize,
  SkinEditorMode,
  SkinEditorPersonalPreference,
  SkinEditorSkinEntry,
  SkinEditorUploadBrandAssetResult,
} from "./skin-editor-types.js";

export interface SkinEditorSaveResult {
  readonly ok: boolean;
  readonly skinId?: string;
  readonly lightReport: ContrastReport | null;
  readonly darkReport: ContrastReport | null;
  /** Set (with both reports `null`) when the skin's name collides with one this
   *  tenant already has — a distinct failure from a contrast-blocked save. */
  readonly nameTaken?: boolean;
}

export interface SkinEditorSaveInput {
  readonly editingSkinId: string | null;
  readonly skinName: string;
  readonly skinDescription: string | null;
  readonly light: SemanticColorTokens;
  readonly dark: SemanticColorTokens;
  readonly branding: SkinEditorBrandingScalars;
}

export type SkinEditorImportResult =
  | { readonly ok: true; readonly tokens: SemanticColorTokens }
  | { readonly ok: false; readonly issues: readonly SkinIssue[] };

export interface SkinEditorActions {
  readonly saveTenantAppearance: (input: SkinEditorSaveInput) => Promise<SkinEditorSaveResult>;
  readonly applyTenantSkin: (skinId: string) => Promise<void>;
  readonly applyPersonalSkin: (skinId: string) => Promise<void>;
  readonly duplicateTenantSkin: (sourceSkinId: string, newName: string) => Promise<void>;
  readonly renameTenantSkin: (
    skinId: string,
    name: string,
    description: string | null,
  ) => Promise<void>;
  readonly deleteTenantSkin: (skinId: string) => Promise<SkinEditorDeletionResult>;
  /** A Server Action returns data, never triggers a download itself — this returns
   *  the exported skin document's JSON TEXT; `handleExportSkin` below is what turns
   *  it into a real browser download (a Blob + a momentary `<a download>` click). */
  readonly exportTenantSkin: (skinId: string, mode: "light" | "dark") => Promise<string>;
  /** Validates an uploaded file for ONE mode (§7.4) and, on success, returns the
   *  complete, gap-filled colour set for that mode — never both modes, and never
   *  auto-applied (see `skin-manager.tsx`'s own doc comment for why import lands in
   *  the candidate rather than a second, parallel persistence path). */
  readonly importSkinMode: (
    mode: "light" | "dark",
    fileText: string,
  ) => Promise<SkinEditorImportResult>;
  readonly savePersonalPreference: (input: SkinEditorPersonalPreference) => Promise<void>;
  /**
   * Real logo/favicon upload (§9.1) — commits IMMEDIATELY on file selection,
   * unlike every colour/scalar control in this organism. A binary upload has no
   * natural "candidate, then Save" shape the way a hex value does: staging a
   * multi-hundred-KB file in memory only to discard it on "Reset to default"
   * (§9.2 rule 5's own escape hatch) would mean re-uploading it, and every
   * comparable real product (an org logo, a Slack avatar) commits a file upload
   * the moment it is chosen, not behind a separate save step. `formData` carries
   * exactly one `file` entry — see `brand-section.tsx`'s own doc comment.
   */
  readonly uploadBrandAsset: (
    kind: SkinEditorBrandAssetKind,
    formData: FormData,
  ) => Promise<SkinEditorUploadBrandAssetResult>;
}

export interface SkinEditorProps {
  readonly canManageTenantAppearance: boolean;
  readonly resetHref: string;
  readonly initialEditingSkinId: string | null;
  readonly initialSkinName: string;
  readonly initialSkinDescription: string | null;
  readonly initialLight: SemanticColorTokens;
  readonly initialDark: SemanticColorTokens;
  readonly initialBranding: SkinEditorBrandingScalars;
  readonly initialBrandAssets: SkinEditorBrandAssets;
  /** Whether a `TenantBranding` row exists yet — `saveBrandAsset`'s real NOT NULL
   *  `activeSkinId` foreign key means an upload has nothing to attach to until
   *  the tenant has saved an appearance at least once (see
   *  `ThemeRepository.saveBrandAsset`'s own doc comment). `brand-section.tsx`
   *  gates its upload controls on this rather than attempting the upload and
   *  surfacing a raw error. */
  readonly hasTenantBranding: boolean;
  readonly initialPersonal: SkinEditorPersonalPreference;
  readonly skins: readonly SkinEditorSkinEntry[];
  readonly actions: SkinEditorActions;
}

interface ScalarFormState {
  readonly skinName: string;
  readonly skinDescription: string | null;
  readonly branding: SkinEditorBrandingScalars;
}

export function SkinEditor({
  canManageTenantAppearance,
  resetHref,
  initialEditingSkinId,
  initialSkinName,
  initialSkinDescription,
  initialLight,
  initialDark,
  initialBranding,
  initialBrandAssets,
  hasTenantBranding,
  initialPersonal,
  skins,
  actions,
}: SkinEditorProps) {
  const t = useTranslations("skinEditor");
  const candidate = useSkinCandidate(initialLight, initialDark);

  const [editingSkinId, setEditingSkinId] = React.useState(initialEditingSkinId);
  const [form, setForm] = React.useState<ScalarFormState>({
    skinName: initialSkinName,
    skinDescription: initialSkinDescription,
    branding: initialBranding,
  });
  const formBaseline = React.useRef(form);
  const [formDirty, setFormDirty] = React.useState(false);

  // Uploads commit immediately (see SkinEditorActions.uploadBrandAsset's own doc
  // comment) — this is real, already-persisted server state mirrored into local
  // state for immediate re-render, never a "candidate" the Discard button reverts.
  const [brandAssets, setBrandAssets] = React.useState<SkinEditorBrandAssets>(initialBrandAssets);

  // `hasTenantBranding` starts as a real, server-resolved value but is NOT itself
  // re-fetched after a save — the initial prop alone would leave the upload
  // gate's own note ("Save your colour scheme once...") visibly wrong for the
  // rest of the session the moment `handleSave` below actually creates the row
  // (a real bug, found live: the note stayed up, and the disabled upload inputs
  // stayed disabled, even immediately after the exact save that satisfies the
  // gate). Tracked as local state instead, flipped to `true` the moment EITHER
  // real path that can create a `TenantBranding` row for the first time
  // succeeds — the main Save (below) or the Skin Manager's "Apply" action
  // (`handleApplyTenantSkin`) — never flipped back to `false` (a session that
  // has ever established branding stays established for the rest of it).
  const [hasTenantBrandingState, setHasTenantBrandingState] = React.useState(hasTenantBranding);

  async function handleUploadBrandAsset(
    kind: SkinEditorBrandAssetKind,
    formData: FormData,
  ): Promise<SkinEditorUploadBrandAssetResult> {
    const result = await actions.uploadBrandAsset(kind, formData);
    if (result.ok) {
      setBrandAssets((previous) => ({
        ...previous,
        ...(kind === "LogoLight"
          ? { logoLightUrl: result.url }
          : kind === "LogoDark"
            ? { logoDarkUrl: result.url }
            : { faviconUrl: result.url }),
      }));
    }
    return result;
  }

  const [personal, setPersonal] = React.useState(initialPersonal);
  const personalBaseline = React.useRef(personal);
  const [personalDirty, setPersonalDirty] = React.useState(false);

  const [editingMode, setEditingMode] = React.useState<"light" | "dark">("light");
  const [previewWholeApp, setPreviewWholeApp] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveFailure, setSaveFailure] = React.useState<{
    light: ContrastReport | null;
    dark: ContrastReport | null;
  } | null>(null);
  /** A distinct failure from `saveFailure` above: the skin's name collided with one
   *  this tenant already has, not a contrast violation — see `SkinEditorSaveResult
   *  .nameTaken`'s own doc comment. */
  const [nameTakenFailure, setNameTakenFailure] = React.useState(false);
  const [navGuardOpen, setNavGuardOpen] = React.useState(false);
  const pendingNavigationRef = React.useRef<(() => void) | null>(null);

  const isDirty = candidate.isDirty || formDirty || personalDirty;

  const previewScopeRef = React.useRef<HTMLDivElement>(null);
  const currentTokens = editingMode === "light" ? candidate.light : candidate.dark;

  // The live-preview effect: applies the currently-edited mode's tokens to whichever
  // scope is active, and reverts on cleanup — which React runs BEFORE re-applying on
  // every dependency change (editingMode, previewWholeApp, or any token edit) and on
  // unmount. This is the entire mechanism; apply-candidate.test.ts proves the
  // primitive it calls, and this effect is what wires it to real component state.
  React.useEffect(() => {
    const scope = previewWholeApp ? document.documentElement : previewScopeRef.current;
    if (!scope) return undefined;
    return applyCandidate(scope, currentTokens);
  }, [currentTokens, previewWholeApp]);

  // Rule 4 (real half): browser navigation, reload, and tab close. Return a string
  // for the small subset of browsers that still render it; modern browsers ignore
  // the value and show their own generic prompt, which is the standards-track
  // behaviour beforeunload has had for years.
  React.useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function guardedNavigate(navigate: () => void) {
    if (isDirty) {
      pendingNavigationRef.current = navigate;
      setNavGuardOpen(true);
    } else {
      navigate();
    }
  }

  function handleTokenChange(key: SemanticColorTokenName, value: string) {
    candidate.setToken(editingMode, key, value);
  }

  function handleBrandingChange(patch: Partial<SkinEditorBrandingScalars>) {
    setForm((prev) => ({ ...prev, branding: { ...prev.branding, ...patch } }));
    setFormDirty(true);
  }

  function handleSkinNameChange(value: string) {
    setForm((prev) => ({ ...prev, skinName: value }));
    setFormDirty(true);
  }

  function handlePersonalChange(patch: Partial<SkinEditorPersonalPreference>) {
    setPersonal((prev) => ({ ...prev, ...patch }));
    setPersonalDirty(true);
  }

  /** Real browser download — a Blob URL and a momentary `<a download>` click, the
   *  standard client-side mechanism (Server Actions themselves cannot trigger a
   *  file save; see the `exportTenantSkin` prop's own doc comment). */
  async function handleExportSkin(skinId: string, mode: "light" | "dark") {
    const text = await actions.exportTenantSkin(skinId, mode);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${skinId}-${mode}.skin.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  async function handleImportSkinMode(
    mode: "light" | "dark",
    fileText: string,
  ): Promise<readonly SkinIssue[]> {
    const result = await actions.importSkinMode(mode, fileText);
    if (!result.ok) return result.issues;
    // Lands in the candidate exactly like any other edit to this one mode — Save's
    // existing atomic/gated/discardable machinery is what actually persists it,
    // rather than a second "unapplied imported skin" flow (see skin-manager.tsx).
    candidate.replaceMode(mode, result.tokens);
    return [];
  }

  /** The Skin Manager's "Apply" action is the SECOND real path (besides Save
   *  above) that can create a `TenantBranding` row for the very first time
   *  (`applyExistingTenantSkin`'s `baseline` argument, server-side) — flips the
   *  same local gate state, for the same reason. */
  async function handleApplyTenantSkin(skinId: string): Promise<void> {
    await actions.applyTenantSkin(skinId);
    setHasTenantBrandingState(true);
  }

  function handleDiscard() {
    candidate.discard();
    setForm(formBaseline.current);
    setFormDirty(false);
    setPersonal(personalBaseline.current);
    setPersonalDirty(false);
    setSaveFailure(null);
    setNameTakenFailure(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveFailure(null);
    setNameTakenFailure(false);
    try {
      if (canManageTenantAppearance && (candidate.isDirty || formDirty)) {
        const result = await actions.saveTenantAppearance({
          editingSkinId,
          skinName: form.skinName,
          skinDescription: form.skinDescription,
          light: candidate.light,
          dark: candidate.dark,
          branding: form.branding,
        });
        if (!result.ok) {
          if (result.nameTaken) {
            setNameTakenFailure(true);
          } else {
            setSaveFailure({ light: result.lightReport, dark: result.darkReport });
          }
          return;
        }
        if (result.skinId) setEditingSkinId(result.skinId);
        candidate.markSaved();
        formBaseline.current = form;
        setFormDirty(false);
        // This IS the real write that creates the TenantBranding row the first
        // time a tenant saves anything — see this file's own doc comment on
        // `hasTenantBrandingState`.
        setHasTenantBrandingState(true);
      }
      if (personalDirty) {
        await actions.savePersonalPreference(personal);
        personalBaseline.current = personal;
        setPersonalDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }

  const failingConditions = saveFailure
    ? combineContrastFailures(saveFailure.light, saveFailure.dark, {
        light: t("preview.modeToggleLight"),
        dark: t("preview.modeToggleDark"),
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="skin-editor-editing-mode">{t("preview.editingModeLabel")}</Label>
          <RadioGroup
            id="skin-editor-editing-mode"
            value={editingMode}
            onValueChange={(value) => setEditingMode(value as "light" | "dark")}
            className="flex flex-row gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="light" id="skin-editor-editing-mode-light" />
              <Label htmlFor="skin-editor-editing-mode-light">{t("preview.modeToggleLight")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="dark" id="skin-editor-editing-mode-dark" />
              <Label htmlFor="skin-editor-editing-mode-dark">{t("preview.modeToggleDark")}</Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch
              id="skin-editor-preview-whole-app"
              checked={previewWholeApp}
              onCheckedChange={setPreviewWholeApp}
            />
            <Label htmlFor="skin-editor-preview-whole-app">{t("preview.wholeAppToggle")}</Label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isDirty ? <Badge variant="warning" label={t("actions.unsavedBadge")} /> : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => guardedNavigate(() => window.location.assign(resetHref))}
          >
            {t("actions.resetLink")}
          </Button>
        </div>
      </div>

      {failingConditions ? (
        <SummaryStrip
          variant="blocking"
          subject={t("contrastBlocked.subject")}
          conditions={failingConditions}
          introText={t("contrastBlocked.introText")}
        />
      ) : null}

      {nameTakenFailure ? (
        <InlineAlert variant="destructive">{t("nameTaken.message", { name: form.skinName })}</InlineAlert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SubTabBar
            tabs={[
              { value: "brand", label: t("sections.brand") },
              { value: "semantic", label: t("sections.semantic") },
              { value: "typography", label: t("sections.typography") },
              { value: "layout", label: t("sections.layout") },
              { value: "modeDirection", label: t("sections.modeDirection") },
            ]}
            aria-label={t("sections.ariaLabel")}
            urlParam={null}
            defaultValue="brand"
          >
            <SubTabBarPanel value="brand">
              <FormField label={t("brand.skinName")} id="skin-editor-skin-name">
                {(field) => (
                  <Input
                    {...field}
                    value={form.skinName}
                    onChange={(event) => handleSkinNameChange(event.target.value)}
                    disabled={!canManageTenantAppearance}
                  />
                )}
              </FormField>
              <BrandSection
                tokens={currentTokens}
                onTokenChange={handleTokenChange}
                branding={form.branding}
                onBrandingChange={handleBrandingChange}
                disabled={!canManageTenantAppearance}
                brandAssets={brandAssets}
                canUpload={canManageTenantAppearance && hasTenantBrandingState}
                onUploadBrandAsset={handleUploadBrandAsset}
              />
            </SubTabBarPanel>
            <SubTabBarPanel value="semantic">
              <SemanticSection
                tokens={currentTokens}
                onTokenChange={handleTokenChange}
                disabled={!canManageTenantAppearance}
              />
            </SubTabBarPanel>
            <SubTabBarPanel value="typography">
              <TypographySection
                fontSize={form.branding.fontSize}
                onFontSizeChange={(value: SkinEditorFontSize) =>
                  handleBrandingChange({ fontSize: value })
                }
                disabled={!canManageTenantAppearance}
              />
            </SubTabBarPanel>
            <SubTabBarPanel value="layout">
              <LayoutSection
                density={form.branding.density}
                onDensityChange={(value) => handleBrandingChange({ density: value })}
                shadowDepth={form.branding.shadowDepth}
                onShadowDepthChange={(value) => handleBrandingChange({ shadowDepth: value })}
                disabled={!canManageTenantAppearance}
              />
            </SubTabBarPanel>
            <SubTabBarPanel value="modeDirection">
              <ModeDirectionSection
                tenantMode={form.branding.defaultMode}
                onTenantModeChange={(value: SkinEditorMode) =>
                  handleBrandingChange({ defaultMode: value })
                }
                tenantDirection={form.branding.defaultDirection}
                onTenantDirectionChange={(value: SkinEditorDirection) =>
                  handleBrandingChange({ defaultDirection: value })
                }
                tenantDisabled={!canManageTenantAppearance}
                personalMode={personal.mode}
                onPersonalModeChange={(value) => handlePersonalChange({ mode: value })}
                personalDirection={personal.direction}
                onPersonalDirectionChange={(value) => handlePersonalChange({ direction: value })}
                personalReducedMotion={personal.reducedMotion ?? false}
                onPersonalReducedMotionChange={(value) =>
                  handlePersonalChange({ reducedMotion: value })
                }
              />
              <div className="mt-6">
                <SkinManager
                  skins={skins}
                  canManage={canManageTenantAppearance}
                  busy={saving}
                  onApplyTenant={handleApplyTenantSkin}
                  onApplyPersonal={actions.applyPersonalSkin}
                  onDuplicate={actions.duplicateTenantSkin}
                  onRename={actions.renameTenantSkin}
                  onDelete={actions.deleteTenantSkin}
                  onExport={handleExportSkin}
                  onImport={handleImportSkinMode}
                />
              </div>
            </SubTabBarPanel>
          </SubTabBar>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleDiscard}
              disabled={!isDirty || saving}
            >
              {t("actions.discard")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!isDirty || saving}
            >
              {saving ? t("actions.saving") : t("actions.save")}
            </Button>
          </div>
        </div>

        <SkinPreview ref={previewScopeRef} />
      </div>

      <Dialog
        open={navGuardOpen}
        onOpenChange={(open) => {
          if (!open) setNavGuardOpen(false);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("unsavedGuard.title")}</DialogTitle>
            <DialogDescription>{t("unsavedGuard.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNavGuardOpen(false)}>
              {t("unsavedGuard.stayAction")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setNavGuardOpen(false);
                pendingNavigationRef.current?.();
              }}
            >
              {t("unsavedGuard.leaveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
