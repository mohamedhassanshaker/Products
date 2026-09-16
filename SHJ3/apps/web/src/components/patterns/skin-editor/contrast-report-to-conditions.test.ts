import { describe, expect, it } from "vitest";
import { checkContrast, semanticColors } from "@shj3/tokens";
import {
  combineContrastFailures,
  contrastReportToConditions,
} from "./contrast-report-to-conditions.js";

describe("contrastReportToConditions", () => {
  it("maps the real checkContrast()'s blockers to SummaryStrip's BlockingCondition shape", () => {
    // A genuine, real failure computed by the actual gate — never a hand-built fixture
    // pretending to be a ContrastReport (the brief's own instruction: call the real
    // appearance-gate.ts / @shj3/tokens contrast module, never reimplement it).
    const unsafe = { ...semanticColors.light, foreground: semanticColors.light.background };
    const report = checkContrast(unsafe);
    expect(report.passed).toBe(false);

    const conditions = contrastReportToConditions(report, "Light");
    expect(conditions.length).toBe(report.blockers.length);
    expect(conditions.length).toBeGreaterThan(0);

    const first = conditions[0];
    const firstCheck = report.blockers[0];
    if (!first || !firstCheck) throw new Error("unreachable — length asserted above");
    expect(first.blocked).toBe(firstCheck.pair.note);
    expect(first.measured).toBe(`${firstCheck.ratio.toFixed(2)}:1`);
    expect(first.threshold).toBe(`${firstCheck.required}:1`);
    expect(first.source).toContain("Light");
    expect(first.source).toContain(firstCheck.pair.fg);
  });

  it("a passing report produces zero conditions", () => {
    const report = checkContrast(semanticColors.light);
    expect(report.passed).toBe(true);
    expect(contrastReportToConditions(report, "Light")).toEqual([]);
  });
});

describe("combineContrastFailures", () => {
  it("returns null when both modes pass — nothing for the caller to render as blocking", () => {
    const light = checkContrast(semanticColors.light);
    const dark = checkContrast(semanticColors.dark);
    expect(combineContrastFailures(light, dark, { light: "Light", dark: "Dark" })).toBeNull();
  });

  it("combines both modes' failures, each labelled with its own mode, into one non-empty tuple", () => {
    const unsafeLight = { ...semanticColors.light, foreground: semanticColors.light.background };
    const unsafeDark = { ...semanticColors.dark, mutedForeground: semanticColors.dark.muted };
    const lightReport = checkContrast(unsafeLight);
    const darkReport = checkContrast(unsafeDark);
    expect(lightReport.passed).toBe(false);
    expect(darkReport.passed).toBe(false);

    const combined = combineContrastFailures(lightReport, darkReport, {
      light: "Light",
      dark: "Dark",
    });

    expect(combined).not.toBeNull();
    const conditions = combined!;
    expect(conditions.length).toBe(lightReport.blockers.length + darkReport.blockers.length);
    expect(conditions.some((c) => c.source.includes("Light"))).toBe(true);
    expect(conditions.some((c) => c.source.includes("Dark"))).toBe(true);
  });

  it("only the failing mode contributes conditions when the other mode already passed", () => {
    const unsafeDark = { ...semanticColors.dark, mutedForeground: semanticColors.dark.muted };
    const lightReport = checkContrast(semanticColors.light);
    const darkReport = checkContrast(unsafeDark);
    expect(lightReport.passed).toBe(true);
    expect(darkReport.passed).toBe(false);

    // Passing reports are passed as null by the caller (see skin-editor.tsx's own
    // usage) — this proves the null branch is handled, not just the report-present one.
    const combined = combineContrastFailures(null, darkReport, { light: "Light", dark: "Dark" });
    expect(combined).not.toBeNull();
    expect(combined!.every((c) => c.source.includes("Dark"))).toBe(true);
  });
});
