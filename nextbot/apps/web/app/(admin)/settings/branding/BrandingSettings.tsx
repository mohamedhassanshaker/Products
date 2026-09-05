"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@nextbot/ui/components/ui/button";
import { Input } from "@nextbot/ui/components/ui/input";
import { Label } from "@nextbot/ui/components/ui/label";
import { Switch } from "@nextbot/ui/components/ui/switch";
import { FieldHint } from "@nextbot/ui/components/ui/field-hint";
import { Alert, AlertDescription } from "@nextbot/ui/components/ui/alert";
import { Skeleton } from "@nextbot/ui/components/ui/skeleton";
import type { TenantBranding } from "@nextbot/contracts";
import { AccessDeniedState } from "@nextbot/ui";
import { fetchJson } from "../../../../src/lib/fetch-json";

const DEFAULT_BRANDING: TenantBranding = {
  primaryColor: "#4f46e5",
  secondaryColor: "#0e3b28",
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  fontFamily: null,
};

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Reads a File as a `data:` URL (FR-ADM-07 — no object-store integration yet, see
 * `packages/contracts/src/tenancy.ts`'s doc comment). */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Auto-generates a 32×32 favicon from the light-variant logo via the browser's
 * native Canvas API (no new image-processing dependency) — FR-ADM-07: "auto-
 * generates a favicon if none is supplied separately." */
function generateFaviconFromLogo(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, 32, 32);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load logo for favicon generation"));
    img.src = dataUrl;
  });
}

export function BrandingSettings() {
  const router = useRouter();
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [whiteLabelEnabled, setWhiteLabelEnabled] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await fetchJson<{ branding: { brandingConfig: TenantBranding | null; whiteLabelEnabled: boolean } }>(
        "/api/v1/admin/branding",
      );
      if (result.kind === "forbidden") {
        setForbidden(true);
        return;
      }
      if (result.kind === "ok") {
        setBranding(result.data.branding.brandingConfig ?? DEFAULT_BRANDING);
        setWhiteLabelEnabled(result.data.branding.whiteLabelEnabled);
      }
    })();
  }, []);

  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !branding) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo exceeds the 2 MB limit.");
      return;
    }
    if (!["image/svg+xml", "image/png"].includes(file.type)) {
      setError("Logo must be an SVG or PNG file.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      let faviconUrl = branding.faviconUrl;
      if (!faviconUrl && file.type === "image/png") {
        try {
          faviconUrl = await generateFaviconFromLogo(dataUrl);
        } catch {
          // Falls back to no favicon rather than blocking the logo upload itself.
        }
      }
      setBranding({ ...branding, logoLightUrl: dataUrl, faviconUrl });
      setError(null);
    } catch {
      // FR-ADM-07: a failed logo upload falls back to the tenant name as a text
      // wordmark, never a broken image icon — leaving `logoLightUrl` untouched (the
      // preview below already renders a text wordmark whenever it's null) is that
      // fallback in practice.
      setError("Couldn't read that file — the logo will show as a text wordmark instead.");
    }
  }

  async function handleSave() {
    if (!branding) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/v1/admin/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branding, whiteLabelEnabled }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.title ?? "Failed to save branding.");
      return;
    }
    setSaved(true);
    // The sidebar/top-bar accent are server-rendered per-navigation in
    // `(admin)/layout.tsx` from the tenant's saved branding row — without this, only
    // this screen's own client-side "Live preview" panel reflects a save, and the
    // persistent chrome stays on the old color until a manual full page reload.
    router.refresh();
  }

  if (forbidden) {
    return <AccessDeniedState moduleLabel="Branding" />;
  }

  if (!branding) return <Skeleton className="h-40 w-full" aria-label="Loading branding settings" />;

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 font-heading text-lg font-semibold">Branding</h1>
      <div className="flex items-start gap-10">
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="branding-primary-color">Primary color</Label>
              <FieldHint
                id="branding-primary-color-hint"
                content="The main accent color used in the customer-facing widget's launcher and header — shown live in the preview panel to the right."
              />
            </div>
            <div className="mt-1 flex gap-2">
              <input
                id="branding-primary-color"
                type="color"
                className="h-8 w-[60px] rounded-none border border-input p-1"
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
              />
              {/* QA Defect D4 (critical a11y): the `Label htmlFor="branding-primary-color"`
                  above only wires to the adjacent native color-swatch `<input>`, not
                  this text field — a screen-reader user tabbing into this input got no
                  label at all. `aria-label` gives it its own accessible name without
                  visually duplicating the "Primary color" text already shown once. */}
              <Input
                id="branding-primary-color-hex"
                aria-label="Primary color (hex value)"
                value={branding.primaryColor}
                onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                className="max-w-[140px]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="branding-secondary-color">Secondary color</Label>
              <FieldHint
                id="branding-secondary-color-hint"
                content="Used for the Admin Console's own top bar when white-labeling is enabled below — separate from the customer-facing widget's primary color above."
              />
            </div>
            <div className="mt-1 flex gap-2">
              <input
                id="branding-secondary-color"
                type="color"
                className="h-8 w-[60px] rounded-none border border-input p-1"
                value={branding.secondaryColor}
                onChange={(e) => setBranding({ ...branding, secondaryColor: e.target.value })}
              />
              {/* QA Defect D4: same fix as the primary-color text input above. */}
              <Input
                id="branding-secondary-color-hex"
                aria-label="Secondary color (hex value)"
                value={branding.secondaryColor}
                onChange={(e) => setBranding({ ...branding, secondaryColor: e.target.value })}
                className="max-w-[140px]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="branding-logo">Logo (SVG or PNG, max 2 MB)</Label>
              <FieldHint
                id="branding-logo-hint"
                content="Uploaded directly (max 2 MB) — a PNG upload with no favicon set yet auto-generates one; if the upload fails, the tenant name is shown as a text wordmark instead."
              />
            </div>
            <Input id="branding-logo" type="file" accept="image/svg+xml,image/png" onChange={handleLogoUpload} className="mt-1" />
          </div>

          <div>
            <div className="flex items-center gap-1">
              <Label htmlFor="branding-font">Font family</Label>
              <FieldHint
                id="branding-font-hint"
                content="The font family name applied to the customer-facing widget's chrome — enter the same name already loaded on your own site; this field doesn't load a font file itself."
              />
            </div>
            <Input
              id="branding-font"
              value={branding.fontFamily ?? ""}
              onChange={(e) => setBranding({ ...branding, fontFamily: e.target.value || null })}
              placeholder="Inter"
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="branding-white-label"
              checked={whiteLabelEnabled}
              onCheckedChange={setWhiteLabelEnabled}
            />
            <Label htmlFor="branding-white-label">
              Enable white-labeling (replaces NextBot branding in the Admin Console chrome)
            </Label>
            <FieldHint
              id="branding-white-label-hint"
              content="Replaces the NextBot logo and colors in the Admin Console's own top bar with the tenant's — off by default so admins always know they're in a NextBot-hosted console."
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {saved && (
            <Alert role="status">
              <AlertDescription>Branding saved.</AlertDescription>
            </Alert>
          )}

          <Button onClick={handleSave} disabled={saving} className="self-start">
            Save branding
          </Button>
        </div>

        {/* Live preview (unchanged from the pre-migration Chakra version): these
            swatches never depended on Chakra's theme system — they're plain
            inline-styled boxes rendering the tenant's own raw hex values directly,
            so they carry over to plain divs verbatim rather than being rebuilt on
            shadcn primitives (Plan Phase 1 explicitly keeps this chrome as-is). */}
        <div className="flex flex-1 flex-col gap-4 rounded-none border p-4">
          <p className="text-sm font-bold">Live preview</p>

          <div>
            {/* D10 (QA fix pass): gray.500 at this font size failed WCAG AA
                contrast (axe-core "color-contrast") — gray.600 clears it. */}
            <p className="mb-1 text-xs text-gray-600">Widget launcher</p>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "9999px",
                background: branding.primaryColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: "1.25rem",
              }}
            >
              💬
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-gray-600">Widget window header</p>
            <div
              style={{
                background: branding.primaryColor,
                color: "white",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
              }}
            >
              {branding.logoLightUrl ? (
                <img src={branding.logoLightUrl} alt="" style={{ width: 20, height: 20, borderRadius: "9999px" }} />
              ) : (
                <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>NextBot</span>
              )}
              <span style={{ fontSize: "0.875rem" }}>Support</span>
            </div>
          </div>

          {whiteLabelEnabled && (
            <div>
              <hr className="mb-2 border-border" />
              <p className="mb-1 text-xs text-gray-600">Admin Console top bar (white-labeled)</p>
              <div
                style={{
                  background: branding.secondaryColor,
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.375rem",
                }}
              >
                {branding.logoLightUrl ? (
                  <img src={branding.logoLightUrl} alt="" style={{ width: 20, height: 20, borderRadius: "9999px" }} />
                ) : (
                  <span style={{ fontSize: "0.875rem" }}>Your Company</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
