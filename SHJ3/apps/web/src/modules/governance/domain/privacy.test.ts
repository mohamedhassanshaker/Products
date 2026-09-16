import { describe, expect, it } from "vitest";
import {
  isValidDataResidency,
  isValidTranscriptRetention,
  retentionCutoff,
  retentionDays,
} from "./privacy.js";

describe("privacy domain", () => {
  it("Year7 is exactly 2555 days, matching docs/data-model.md §10.5's own sweep formula", () => {
    expect(retentionDays("Year7")).toBe(2555);
  });

  it("computes a real cutoff date by subtracting the retention window from now", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const cutoff = retentionCutoff("Days90", now);
    expect(cutoff.toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });

  it("validates the real closed vocabularies transcribed from CK_PrivacyConfigs_*", () => {
    expect(isValidTranscriptRetention("Year7")).toBe(true);
    expect(isValidTranscriptRetention("Year10")).toBe(false);
    expect(isValidDataResidency("UaeDubaiDc")).toBe(true);
    expect(isValidDataResidency("Mars")).toBe(false);
  });
});
