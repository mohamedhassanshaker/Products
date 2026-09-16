import { describe, expect, it } from "vitest";
import { applyCandidate } from "./apply-candidate.js";

/**
 * Proves the actual inline `style` properties before/after apply and after discard —
 * not merely that a function was called (the brief's own instruction). jsdom's real
 * `CSSStyleDeclaration` is exercised directly via `document.createElement`, no mocks.
 */
describe("applyCandidate", () => {
  it("writes candidate tokens as inline custom properties on the scope", () => {
    const scope = document.createElement("div");
    applyCandidate(scope, { primary: "#112233", cardForeground: "#445566" });

    expect(scope.style.getPropertyValue("--primary")).toBe("#112233");
    expect(scope.style.getPropertyValue("--card-foreground")).toBe("#445566");
  });

  it("the revert closure removes a property that had no prior inline value", () => {
    const scope = document.createElement("div");
    const revert = applyCandidate(scope, { primary: "#112233" });
    expect(scope.style.getPropertyValue("--primary")).toBe("#112233");

    revert();

    // Removed entirely, not set to empty string with the declaration still present —
    // getPropertyValue returns "" either way, so assert via the property list itself.
    expect(scope.style.getPropertyValue("--primary")).toBe("");
    expect(scope.style.cssText).not.toContain("--primary");
  });

  it("the revert closure restores the exact prior inline value, not just clears it", () => {
    const scope = document.createElement("div");
    scope.style.setProperty("--primary", "#ORIGINAL");

    const revert = applyCandidate(scope, { primary: "#CANDIDATE" });
    expect(scope.style.getPropertyValue("--primary")).toBe("#CANDIDATE");

    revert();
    expect(scope.style.getPropertyValue("--primary")).toBe("#ORIGINAL");
  });

  it("reverting NEVER mutates the server-rendered stylesheet, only this element's inline style", () => {
    const styleEl = document.createElement("style");
    styleEl.id = "shj3-theme";
    styleEl.textContent = ":root { --primary: #SERVER; }";
    document.head.appendChild(styleEl);

    const scope = document.createElement("div");
    const revert = applyCandidate(scope, { primary: "#CANDIDATE" });
    revert();

    expect(document.getElementById("shj3-theme")?.textContent).toBe(
      ":root { --primary: #SERVER; }",
    );
    document.head.removeChild(styleEl);
  });

  it("a second apply before the first reverts snapshots the first apply's value, so reverting only the second leaves the first's preview intact", () => {
    const scope = document.createElement("div");
    const revertFirst = applyCandidate(scope, { primary: "#FIRST" });
    const revertSecond = applyCandidate(scope, { primary: "#SECOND" });

    expect(scope.style.getPropertyValue("--primary")).toBe("#SECOND");

    revertSecond();
    expect(scope.style.getPropertyValue("--primary")).toBe("#FIRST");

    revertFirst();
    expect(scope.style.getPropertyValue("--primary")).toBe("");
  });

  it("applies a real multi-token candidate (both modes' worth of keys) independently per key", () => {
    const scope = document.createElement("div");
    const revert = applyCandidate(scope, {
      primary: "#111111",
      primaryForeground: "#ffffff",
      background: "#fafafa",
    });

    expect(scope.style.getPropertyValue("--primary")).toBe("#111111");
    expect(scope.style.getPropertyValue("--primary-foreground")).toBe("#ffffff");
    expect(scope.style.getPropertyValue("--background")).toBe("#fafafa");

    revert();
    expect(scope.style.cssText).toBe("");
  });
});
