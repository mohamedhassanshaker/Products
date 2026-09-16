import { describe, expect, it } from "vitest";
import { humanizeIntentKey } from "./intent-label.js";

describe("humanizeIntentKey", () => {
  it("splits snake_case", () => {
    expect(humanizeIntentKey("pay_utilities_bill")).toBe("Pay utilities bill");
  });

  it("splits PascalCase / camelCase", () => {
    expect(humanizeIntentKey("PayUtilitiesBill")).toBe("Pay utilities bill");
  });

  it("splits kebab-case", () => {
    expect(humanizeIntentKey("library-membership")).toBe("Library membership");
  });

  it("falls back to Unclassified for null or blank", () => {
    expect(humanizeIntentKey(null)).toBe("Unclassified");
    expect(humanizeIntentKey("   ")).toBe("Unclassified");
  });
});
