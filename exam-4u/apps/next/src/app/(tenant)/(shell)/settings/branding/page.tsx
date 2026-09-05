'use client';

import { useEffect, useState } from 'react';
import { Badge, Box, Button, Heading, HStack, Input, Spinner, Text, VStack, chakra } from '@chakra-ui/react';
import * as brandingApi from '@/lib/tenant-console/branding-api';
import { isTenantApiError } from '@/lib/tenant-console/api-error';
import { useTenantAuthContext } from '@/lib/tenant-console/auth-context';

type LoadState = 'loading' | 'loaded' | 'error';

/** Client-side, pre-submit-only format pre-check (mirrors legacy's `BrandingSettingsComponent` —
 * `docs/design/UX_GUIDELINES.md` §5.2.1 equivalent) — duplicates, never replaces, the server's own
 * `normalizeHex` validation (`server/platform/tenants/domain/color-contrast.ts`). */
const HEX_PATTERN = /^#?[0-9A-Fa-f]{6}$/;

/**
 * Branding settings screen (`/settings/branding`, migration plan Phase 9 sub-slice "9a", FR-MT-10),
 * gated on `tenant.settings.manage` — the same permission `PATCH /api/tenant/branding` itself
 * requires. Ported UX from legacy's `BrandingSettingsComponent`: one form, one "Save changes" action
 * for both fields, with a separate immediate/no-confirmation "Reset to default" action for the accent
 * color specifically.
 *
 * **Contrast validation is exclusively server-side** — this page's live swatch preview is purely
 * cosmetic and never gates submission; the `INSUFFICIENT_COLOR_CONTRAST` error's exact `ratio`/
 * `required`/`failingSurface` are surfaced verbatim from the server response, never paraphrased,
 * matching legacy's own documented UX rule.
 */
export default function BrandingSettingsPage() {
  const { hasPermission } = useTenantAuthContext();
  const [state, setState] = useState<LoadState>('loading');
  const [accentInput, setAccentInput] = useState('');
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [effectiveAccentColor, setEffectiveAccentColor] = useState('5C6BC0');
  const [saving, setSaving] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [contrastError, setContrastError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission('tenant.settings.manage')) return;
    let cancelled = false;
    brandingApi
      .getBranding()
      .then((branding) => {
        if (cancelled) return;
        setAccentInput(branding.accentColorOverride ?? '');
        setLogoUrlInput(branding.logoUrl ?? '');
        setEffectiveAccentColor(branding.effectiveAccentColor);
        setState('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hasPermission]);

  if (!hasPermission('tenant.settings.manage')) {
    return (
      <Box>
        <Heading size="md" mb="2">
          Branding
        </Heading>
        <Text color="gray.600">You do not have permission to view this page.</Text>
      </Box>
    );
  }

  async function handleSave() {
    setFormatError(null);
    setContrastError(null);
    setSaveMessage(null);

    const trimmedAccent = accentInput.trim();
    // Client-side format pre-check only — saves an avoidable round-trip for an obvious typo; the
    // server's own `normalizeHex` check (via `TenantsService.updateBranding`) is the real enforcement.
    if (trimmedAccent && !HEX_PATTERN.test(trimmedAccent)) {
      setFormatError('Enter a valid 6-digit hex color, e.g. #3949AB.');
      return;
    }
    const normalizedAccent = trimmedAccent ? trimmedAccent.replace(/^#/, '').toUpperCase() : null;

    setSaving(true);
    try {
      const updated = await brandingApi.updateBranding({
        accentColorOverride: normalizedAccent,
        logoUrl: logoUrlInput.trim() || null,
      });
      setAccentInput(updated.accentColorOverride ?? '');
      setLogoUrlInput(updated.logoUrl ?? '');
      setEffectiveAccentColor(updated.effectiveAccentColor);
      setSaveMessage('Branding updated.');
    } catch (err) {
      handleSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetAccent() {
    setFormatError(null);
    setContrastError(null);
    setSaveMessage(null);
    setSaving(true);
    try {
      const updated = await brandingApi.updateBranding({ accentColorOverride: null });
      setAccentInput('');
      setEffectiveAccentColor(updated.effectiveAccentColor);
      setSaveMessage('Accent color reset to default.');
    } catch {
      setSaveMessage('Could not reset the accent color. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleSaveError(err: unknown) {
    if (!isTenantApiError(err)) {
      setSaveMessage('Something went wrong. Please check your connection and try again.');
      return;
    }
    if (err.code === 'INVALID_COLOR_FORMAT') {
      setFormatError('Enter a valid 6-digit hex color, e.g. #3949AB.');
      return;
    }
    if (err.code === 'INSUFFICIENT_COLOR_CONTRAST') {
      const details = err.details as { ratio: number; required: number; failingSurface: 'light' | 'dark' } | undefined;
      if (details) {
        setContrastError(
          `This color doesn't have enough contrast. It measures ${details.ratio}:1 against the ` +
            `${details.failingSurface} surface — ${details.required}:1 is required. Try a ` +
            `${details.failingSurface === 'light' ? 'darker' : 'lighter'} shade.`,
        );
      } else {
        setContrastError(err.message);
      }
      return;
    }
    setSaveMessage(err.message || 'Could not save branding. Please try again.');
  }

  const previewColor = accentInput.trim() ? `#${accentInput.trim().replace(/^#/, '')}` : `#${effectiveAccentColor}`;

  return (
    <Box maxW="lg">
      <Heading size="md" mb="2">
        Branding
      </Heading>
      <Text color="gray.600" mb="6" fontSize="sm">
        Customize your organization&apos;s accent color and logo. The accent color must have sufficient
        contrast (WCAG 2.2 AA) against both light and dark surfaces — an insufficiently-contrasting
        color is rejected, never silently applied.
      </Text>

      {state === 'loading' && <Spinner size="sm" />}

      {state === 'error' && (
        <Box role="alert" bg="red.subtle" color="red.fg" borderRadius="md" px="4" py="3">
          <Text>We couldn&apos;t load your branding settings. Please refresh and try again.</Text>
        </Box>
      )}

      {state === 'loaded' && (
        <VStack align="stretch" gap="6" data-testid="branding-form">
          <Box>
            <chakra.label fontWeight="medium" display="block" mb="1" htmlFor="accent-color-input">
              Accent color
            </chakra.label>
            <HStack>
              <Input
                id="accent-color-input"
                data-testid="accent-color-input"
                placeholder="#3949AB"
                value={accentInput}
                onChange={(e) => setAccentInput(e.target.value)}
                maxW="200px"
                aria-describedby="accent-hint accent-server-error"
              />
              <input
                type="color"
                aria-label="Accent color picker"
                data-testid="accent-color-picker"
                value={previewColor}
                onChange={(e) => setAccentInput(e.target.value.replace('#', ''))}
              />
              <Box
                data-testid="accent-color-preview-swatch"
                w="8"
                h="8"
                borderRadius="md"
                borderWidth="1px"
                bg={previewColor}
                aria-hidden="true"
              />
            </HStack>
            <Text id="accent-hint" fontSize="xs" color="gray.500" mt="1">
              Leave blank to use the platform default.
            </Text>
            {formatError && (
              <Text id="accent-server-error" role="alert" color="red.fg" fontSize="sm" mt="1">
                {formatError}
              </Text>
            )}
            {contrastError && (
              <Text id="accent-server-error" role="alert" color="red.fg" fontSize="sm" mt="1" data-testid="contrast-error">
                {contrastError}
              </Text>
            )}
            <Button
              variant="ghost"
              size="sm"
              mt="2"
              onClick={handleResetAccent}
              disabled={saving}
              data-testid="reset-accent-button"
            >
              Reset to default color
            </Button>
          </Box>

          <Box>
            <Text fontSize="xs" color="gray.500" mb="1">
              Preview
            </Text>
            <HStack>
              <chakra.a href="#" color={previewColor} data-testid="preview-sample-link" onClick={(e) => e.preventDefault()}>
                Sample link
              </chakra.a>
              <Badge colorPalette="brand" data-testid="preview-badge">
                Preview badge
              </Badge>
            </HStack>
          </Box>

          <Box>
            <chakra.label fontWeight="medium" display="block" mb="1" htmlFor="logo-url-input">
              Logo URL
            </chakra.label>
            <Input
              id="logo-url-input"
              data-testid="logo-url-input"
              placeholder="https://example.com/logo.png"
              value={logoUrlInput}
              onChange={(e) => setLogoUrlInput(e.target.value)}
            />
          </Box>

          {saveMessage && (
            <Text role="status" fontSize="sm" data-testid="save-message">
              {saveMessage}
            </Text>
          )}

          <Button colorPalette="brand" onClick={handleSave} disabled={saving} data-testid="save-branding-button" alignSelf="start">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </VStack>
      )}
    </Box>
  );
}
