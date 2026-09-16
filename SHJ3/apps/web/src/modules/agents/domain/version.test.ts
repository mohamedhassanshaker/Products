import { describe, expect, it } from "vitest";
import {
  INITIAL_DRAFT_VERSION,
  nextDraftVersion,
  publishedVersionNumber,
  versionLabel,
} from "./version.js";

describe("versionLabel", () => {
  it("formats major.minor with a leading v", () => {
    expect(versionLabel({ major: 1, minor: 4 })).toBe("v1.4");
    expect(versionLabel({ major: 0, minor: 9 })).toBe("v0.9");
  });
});

describe("INITIAL_DRAFT_VERSION", () => {
  it("is v0.1", () => {
    expect(INITIAL_DRAFT_VERSION).toEqual({ major: 0, minor: 1 });
  });
});

describe("publishedVersionNumber", () => {
  it("graduates a major-0 draft to v1.0 on first publish", () => {
    expect(publishedVersionNumber({ major: 0, minor: 1 })).toEqual({ major: 1, minor: 0 });
    expect(publishedVersionNumber({ major: 0, minor: 9 })).toEqual({ major: 1, minor: 0 });
  });

  it("leaves a forked draft (major >= 1) unchanged", () => {
    expect(publishedVersionNumber({ major: 1, minor: 5 })).toEqual({ major: 1, minor: 5 });
    expect(publishedVersionNumber({ major: 2, minor: 0 })).toEqual({ major: 2, minor: 0 });
  });
});

describe("nextDraftVersion", () => {
  it("bumps the minor only, keeping major fixed", () => {
    expect(nextDraftVersion({ major: 1, minor: 4 })).toEqual({ major: 1, minor: 5 });
    expect(nextDraftVersion({ major: 2, minor: 1 })).toEqual({ major: 2, minor: 2 });
  });
});
