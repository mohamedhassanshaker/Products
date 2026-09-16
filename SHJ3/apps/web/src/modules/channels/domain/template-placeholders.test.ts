import { describe, expect, it } from "vitest";
import { placeholderCountMatchesVariables } from "./template-placeholders.js";

describe("placeholderCountMatchesVariables", () => {
  it("matches when the count agrees", () => {
    expect(placeholderCountMatchesVariables("Hi {{1}}, your bill is {{2}}.", 2)).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(placeholderCountMatchesVariables("Hi {{1}}, your bill is {{2}}.", 1)).toBe(false);
  });

  it("counts a repeated placeholder once", () => {
    expect(placeholderCountMatchesVariables("{{1}} confirmed. Thanks {{1}}!", 1)).toBe(true);
  });

  it("accepts zero placeholders with zero variables", () => {
    expect(placeholderCountMatchesVariables("Thanks for contacting us.", 0)).toBe(true);
  });
});
