// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("NextBot.init (embed loader, FR-OC-01)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs NEXTBOT_INIT_ERROR and mounts no DOM when tenantId is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { init } = await import("./nextbot-loader.js");
    // @ts-expect-error intentionally omitting the required field
    init({ channelId: "wc_1" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("NEXTBOT_INIT_ERROR: tenantId is required"));
    expect(document.getElementById("nextbot-widget-iframe")).toBeNull();
  });

  it("logs NEXTBOT_INIT_ERROR and mounts no DOM when channelId is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { init } = await import("./nextbot-loader.js");
    // @ts-expect-error intentionally omitting the required field
    init({ tenantId: "acme" });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("NEXTBOT_INIT_ERROR: channelId is required"));
    expect(document.getElementById("nextbot-widget-iframe")).toBeNull();
  });

  it("mounts exactly one iframe with a static, descriptive title", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.title).toBe("NextBot chat widget");
    expect(document.querySelectorAll("#nextbot-widget-iframe")).toHaveLength(1);
  });

  it("encodes tenantId/channelId into the iframe src query string", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;
    const url = new URL(iframe.src);
    expect(url.searchParams.get("tenantId")).toBe("acme");
    expect(url.searchParams.get("channelId")).toBe("wc_1");
    expect(url.searchParams.get("config")).toBeTruthy();
  });

  it("applies the collapsed footprint at the configured position", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", position: "top-left", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;
    expect(iframe.style.top).toBe("16px");
    expect(iframe.style.left).toBe("16px");
    expect(iframe.style.width).toBe("64px");
  });

  it("defaults to bottom-right when no position is configured", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;
    expect(iframe.style.bottom).toBe("16px");
    expect(iframe.style.right).toBe("16px");
  });

  it("calling init() twice reuses the same iframe element (idempotent)", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const first = document.getElementById("nextbot-widget-iframe");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const second = document.getElementById("nextbot-widget-iframe");
    expect(document.querySelectorAll("#nextbot-widget-iframe")).toHaveLength(1);
    expect(first).toBe(second);
  });

  it("resizes the iframe on a nextbot:resize message from its own contentWindow", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "nextbot:resize", state: "expanded", width: "400px", height: "600px" },
        source: iframe.contentWindow,
      }),
    );

    expect(iframe.style.width).toBe("400px");
    expect(iframe.style.height).toBe("600px");
  });

  it("ignores a resize message from a source other than its own iframe", async () => {
    const { init } = await import("./nextbot-loader.js");
    init({ tenantId: "acme", channelId: "wc_1", baseUrl: "https://cdn.example.com/widget/" });
    const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "nextbot:resize", state: "expanded", width: "999px", height: "999px" },
        source: null,
      }),
    );

    expect(iframe.style.width).toBe("64px");
  });

  it("registers window.NextBot.init as the global entry point", async () => {
    await import("./nextbot-loader.js");
    expect(typeof window.NextBot?.init).toBe("function");
  });

  describe("D1 — widget base URL resolution survives init() being called from a separate script block", () => {
    afterEach(() => {
      // Restore a clean, no-currentScript DOM state so later tests in this file
      // (and other describe blocks re-importing the module) aren't affected by
      // this block's `document.currentScript` override.
      Object.defineProperty(document, "currentScript", { value: null, configurable: true });
    });

    it("captures document.currentScript at module-load time and uses it even after currentScript later changes (the spec's own worked example: a separate inline <script> calls init())", async () => {
      vi.resetModules();

      // Simulate the browser evaluating `<script src="https://cdn.example.com/loader/nextbot.js">`
      // — matching the real deployed layout (`apps/widget-embed/nginx.conf`:
      // `/loader/nextbot.js` and `/widget/index.html` are SIBLING directories, not
      // nested) — while *this* script's own top-level code runs, `document.currentScript`
      // is this element, with a real, non-empty `.src`.
      const loaderScriptEl = document.createElement("script");
      Object.defineProperty(loaderScriptEl, "src", {
        value: "https://cdn.example.com/loader/nextbot.js",
        configurable: true,
      });
      Object.defineProperty(document, "currentScript", { value: loaderScriptEl, configurable: true });

      const { init } = await import("./nextbot-loader.js");

      // Now simulate the page moving on to a *separate*, later inline <script>
      // block — the spec's own worked example calls `NextBot.init({...})` from
      // here, not from inside the loader's own <script> tag. A real browser's
      // `document.currentScript` at this point is this inline script, whose `.src`
      // is `""` (not `undefined`) — the exact condition that made the pre-fix
      // `?? window.location.href` fallback never engage and `new URL(...)` throw.
      const inlineScriptEl = document.createElement("script");
      Object.defineProperty(document, "currentScript", { value: inlineScriptEl, configurable: true });

      expect(() => init({ tenantId: "acme", channelId: "wc_1" })).not.toThrow();

      const iframe = document.getElementById("nextbot-widget-iframe") as HTMLIFrameElement;
      expect(iframe).not.toBeNull();
      const url = new URL(iframe.src);
      expect(url.origin).toBe("https://cdn.example.com");
      // D2 / QA Final Review B3: the loader must request the widget SPA's actual
      // built filename, at the real sibling `/widget/` path — not nested under
      // the loader's own `/loader/` directory.
      expect(url.pathname).toBe("/widget/index.html");
    });
  });
});
