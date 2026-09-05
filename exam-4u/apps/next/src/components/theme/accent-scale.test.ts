import { describe, expect, it } from 'vitest';
import { ACCENT_SCALE_STEPS, accentScaleToCssVars, deriveAccentScale } from './accent-scale';

function luminanceOrdinal(hex: string): number {
  // A simple, monotonic-with-lightness proxy (sum of channels) — sufficient to assert relative
  // ordering between ramp steps without re-implementing `color-contrast.ts`'s full WCAG luminance
  // formula (this test is about `accent-scale.ts`'s own monotonicity, not WCAG contrast math).
  const stripped = hex.replace('#', '');
  return (
    parseInt(stripped.slice(0, 2), 16) + parseInt(stripped.slice(2, 4), 16) + parseInt(stripped.slice(4, 6), 16)
  );
}

describe('deriveAccentScale', () => {
  it('returns the exact, unmodified base hex as the 500 step', () => {
    const scale = deriveAccentScale('#5C6BC0');
    expect(scale['500']).toBe('#5C6BC0');
  });

  it('accepts a hex with or without a leading #, case-insensitively', () => {
    expect(deriveAccentScale('5c6bc0')['500']).toBe('#5C6BC0');
    expect(deriveAccentScale('#5C6BC0')['500']).toBe(deriveAccentScale('5C6BC0')['500']);
  });

  it('produces all 10 documented steps', () => {
    const scale = deriveAccentScale('#5C6BC0');
    for (const step of ACCENT_SCALE_STEPS) {
      expect(scale[step]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('is monotonically lighter from 500 up to 50, and monotonically darker from 500 down to 900', () => {
    const scale = deriveAccentScale('#5C6BC0');
    const tints = ['500', '400', '300', '200', '100', '50'] as const;
    for (let i = 1; i < tints.length; i++) {
      expect(luminanceOrdinal(scale[tints[i]])).toBeGreaterThanOrEqual(luminanceOrdinal(scale[tints[i - 1]]));
    }
    const shades = ['500', '600', '700', '800', '900'] as const;
    for (let i = 1; i < shades.length; i++) {
      expect(luminanceOrdinal(scale[shades[i]])).toBeLessThanOrEqual(luminanceOrdinal(scale[shades[i - 1]]));
    }
  });

  it('holds for a very dark base color (near-black) without producing an out-of-range channel', () => {
    const scale = deriveAccentScale('#0A0A0A');
    for (const step of ACCENT_SCALE_STEPS) {
      expect(scale[step]).toMatch(/^#[0-9A-F]{6}$/);
    }
    // 900 (darkest shade) must still be darker than or equal to 500 even starting from near-black.
    expect(luminanceOrdinal(scale['900'])).toBeLessThanOrEqual(luminanceOrdinal(scale['500']));
  });

  it('holds for a very light base color (near-white) without producing an out-of-range channel', () => {
    const scale = deriveAccentScale('#FAFAFA');
    for (const step of ACCENT_SCALE_STEPS) {
      expect(scale[step]).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(luminanceOrdinal(scale['50'])).toBeGreaterThanOrEqual(luminanceOrdinal(scale['500']));
  });

  it('throws a plain Error for a malformed hex (defensive assertion, not a DomainError)', () => {
    expect(() => deriveAccentScale('not-a-color')).toThrow(Error);
  });

  it('is deterministic (same input always produces the identical ramp)', () => {
    expect(deriveAccentScale('#3949AB')).toEqual(deriveAccentScale('#3949AB'));
  });
});

describe('accentScaleToCssVars', () => {
  it('emits --brand-accent aliasing the exact 500 value, plus every --brand-accent-{step} var', () => {
    const scale = deriveAccentScale('#5C6BC0');
    const vars = accentScaleToCssVars(scale);
    expect(vars['--brand-accent']).toBe(scale['500']);
    for (const step of ACCENT_SCALE_STEPS) {
      expect(vars[`--brand-accent-${step}`]).toBe(scale[step]);
    }
  });
});
