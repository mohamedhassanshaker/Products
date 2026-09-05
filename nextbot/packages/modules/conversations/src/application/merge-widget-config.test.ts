import { describe, expect, it } from "vitest";
import { mergeWidgetConfigWithBranding } from "./merge-widget-config.js";

describe("mergeWidgetConfigWithBranding (FR-ADM-07)", () => {
  it("returns the channel config unchanged when no branding is configured", () => {
    const config = { position: "bottom-right" as const };
    expect(mergeWidgetConfigWithBranding(config, null)).toEqual(config);
  });

  it("fills in theme defaults from the tenant brand profile when the channel didn't set them", () => {
    const merged = mergeWidgetConfigWithBranding(
      {},
      {
        primaryColor: "#1B6B4A",
        secondaryColor: "#0E3B28",
        logoLightUrl: "https://example.com/logo.svg",
        logoDarkUrl: null,
        faviconUrl: null,
        fontFamily: "Inter",
      },
    );
    expect(merged.theme?.primaryColor).toBe("#1B6B4A");
    expect(merged.theme?.fontFamily).toBe("Inter");
    expect(merged.theme?.launcherIcon).toBe("https://example.com/logo.svg");
  });

  it("a channel-level theme override takes priority over the tenant brand profile", () => {
    const merged = mergeWidgetConfigWithBranding(
      { theme: { primaryColor: "#FF0000" } },
      { primaryColor: "#1B6B4A", secondaryColor: "#000", logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, fontFamily: null },
    );
    expect(merged.theme?.primaryColor).toBe("#FF0000");
  });
});
