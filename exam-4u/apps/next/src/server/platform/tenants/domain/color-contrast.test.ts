import { describe, expect, it } from 'vitest';
import { contrastRatio, normalizeHex, relativeLuminance, validateAccent } from './color-contrast';
import { InsufficientColorContrastError, InvalidColorFormatError } from './errors';

// Coverage mirrors legacy's own `color-contrast.spec.ts` (migration plan: "unit tests matching
// legacy's own spec file's coverage").
const CFG = { surfaceLight: 'FFFFFF', surfaceDark: '121212', minRatio: 3.0 };

describe('normalizeHex', () => {
  it('strips a leading # and uppercases', () => {
    expect(normalizeHex('#3949ab')).toBe('3949AB');
    expect(normalizeHex('3949ab')).toBe('3949AB');
  });

  it('trims whitespace before validating', () => {
    expect(normalizeHex('  #FFFFFF  ')).toBe('FFFFFF');
  });

  it.each(['12345', '1234567', 'GGGGGG', '', '#12345Z'])(
    'rejects a malformed value %p with InvalidColorFormatError',
    (input) => {
      expect(() => normalizeHex(input)).toThrow(InvalidColorFormatError);
    },
  );
});

describe('relativeLuminance', () => {
  it('computes 1.0 for pure white and ~0 for pure black', () => {
    expect(relativeLuminance('FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('000000')).toBeCloseTo(0, 5);
  });
});

describe('contrastRatio', () => {
  it('is order-independent', () => {
    expect(contrastRatio('FFFFFF', '000000')).toBeCloseTo(contrastRatio('000000', 'FFFFFF'), 10);
  });

  it('computes the canonical white/black ratio of 21:1', () => {
    expect(contrastRatio('FFFFFF', '000000')).toBeCloseTo(21, 1);
  });

  it('is 1.0 for identical colors', () => {
    expect(contrastRatio('3949AB', '3949AB')).toBeCloseTo(1, 5);
  });
});

describe('validateAccent — WCAG 2.2 AA boundary (FR-MT-10 / LLD §9.11)', () => {
  it('accepts a color with sufficient contrast against both surfaces and returns the normalized hex', () => {
    expect(validateAccent('#5C6BC0', CFG)).toBe('5C6BC0');
  });

  it('rejects a malformed hex with InvalidColorFormatError before any contrast math runs', () => {
    expect(() => validateAccent('not-a-color', CFG)).toThrow(InvalidColorFormatError);
  });

  it('rejects a color failing contrast against the light surface, naming failingSurface: light', () => {
    let caught: InsufficientColorContrastError | undefined;
    try {
      validateAccent('EEEEEE', CFG);
    } catch (err) {
      caught = err as InsufficientColorContrastError;
    }
    expect(caught).toBeInstanceOf(InsufficientColorContrastError);
    expect(caught?.details).toEqual(expect.objectContaining({ failingSurface: 'light', required: 3.0 }));
    expect((caught?.details as { ratio: number }).ratio).toBeLessThan(3.0);
  });

  it('rejects a color failing contrast against the dark surface, naming failingSurface: dark', () => {
    let caught: InsufficientColorContrastError | undefined;
    try {
      validateAccent('1A1A1A', CFG);
    } catch (err) {
      caught = err as InsufficientColorContrastError;
    }
    expect(caught).toBeInstanceOf(InsufficientColorContrastError);
    expect(caught?.details).toEqual(expect.objectContaining({ failingSurface: 'dark', required: 3.0 }));
  });

  it('reports the ratio rounded to 2 decimal places', () => {
    let caught: InsufficientColorContrastError | undefined;
    try {
      validateAccent('EEEEEE', CFG);
    } catch (err) {
      caught = err as InsufficientColorContrastError;
    }
    const ratio = (caught?.details as { ratio: number }).ratio;
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBe(Math.round(ratio * 100) / 100);
  });

  it('accepts exactly at the worst-surface boundary (contrast ratio >= minRatio passes)', () => {
    const candidate = '808080';
    const worstRatio = Math.min(contrastRatio(candidate, 'FFFFFF'), contrastRatio(candidate, '121212'));
    const cfg = { surfaceLight: 'FFFFFF', surfaceDark: '121212', minRatio: worstRatio };
    expect(() => validateAccent(candidate, cfg)).not.toThrow();
  });

  it('rejects when the worst-surface ratio is a hair below minRatio (exclusive on the failing side)', () => {
    const candidate = '808080';
    const worstRatio = Math.min(contrastRatio(candidate, 'FFFFFF'), contrastRatio(candidate, '121212'));
    const cfg = { surfaceLight: 'FFFFFF', surfaceDark: '121212', minRatio: worstRatio + 0.001 };
    expect(() => validateAccent(candidate, cfg)).toThrow(InsufficientColorContrastError);
  });
});
