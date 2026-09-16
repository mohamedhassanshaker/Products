import { describe, expect, it } from "vitest";
import { buildWidgetEmbedSnippet } from "./embed-snippet.js";

describe("buildWidgetEmbedSnippet", () => {
  it("carries the tenant-scoped channel key and no secret", () => {
    const snippet = buildWidgetEmbedSnippet({
      tenantSlug: "sewa",
      scriptOrigin: "https://assistant.shj.ae",
    });
    expect(snippet).toBe(
      '<script src="https://assistant.shj.ae/embed/widget.js" data-channel-key="sewa.WebWidget" async defer></script>',
    );
    expect(snippet).not.toMatch(/secret|token|key=.*[0-9a-f]{16}/i);
  });
});
