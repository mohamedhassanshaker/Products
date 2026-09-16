import { describe, expect, it } from "vitest";
import {
  INITIAL_PIPELINE_DRAFT_VERSION,
  nextPipelineDraftVersion,
  pipelineVersionLabel,
  publishedPipelineVersionNumber,
} from "./pipeline-version.js";

describe("pipelineVersionLabel", () => {
  it("formats major.minor with a leading v", () => {
    expect(pipelineVersionLabel({ major: 1, minor: 4 })).toBe("v1.4");
    expect(pipelineVersionLabel({ major: 0, minor: 9 })).toBe("v0.9");
  });
});

describe("INITIAL_PIPELINE_DRAFT_VERSION", () => {
  it("is v0.1", () => {
    expect(INITIAL_PIPELINE_DRAFT_VERSION).toEqual({ major: 0, minor: 1 });
  });
});

describe("publishedPipelineVersionNumber", () => {
  it("graduates a major-0 draft to v1.0 on first publish", () => {
    expect(publishedPipelineVersionNumber({ major: 0, minor: 1 })).toEqual({ major: 1, minor: 0 });
    expect(publishedPipelineVersionNumber({ major: 0, minor: 9 })).toEqual({ major: 1, minor: 0 });
  });

  it("leaves a forked draft (major >= 1) unchanged", () => {
    expect(publishedPipelineVersionNumber({ major: 1, minor: 5 })).toEqual({ major: 1, minor: 5 });
    expect(publishedPipelineVersionNumber({ major: 2, minor: 0 })).toEqual({ major: 2, minor: 0 });
  });
});

describe("nextPipelineDraftVersion", () => {
  it("bumps the minor only, keeping major fixed", () => {
    expect(nextPipelineDraftVersion({ major: 1, minor: 4 })).toEqual({ major: 1, minor: 5 });
    expect(nextPipelineDraftVersion({ major: 2, minor: 1 })).toEqual({ major: 2, minor: 2 });
  });
});
