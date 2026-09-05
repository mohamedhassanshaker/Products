import { describe, expect, it } from "vitest";
import { mintGenerationGraphLabel } from "./graph-label.js";

describe("mintGenerationGraphLabel", () => {
  it("produces a label matching the G_<32 hex chars> format graph-store's own validator requires", () => {
    const label = mintGenerationGraphLabel();
    expect(label).toMatch(/^G_[0-9a-f]{32}$/);
  });

  it("produces a unique label on every call", () => {
    const a = mintGenerationGraphLabel();
    const b = mintGenerationGraphLabel();
    expect(a).not.toBe(b);
  });
});
