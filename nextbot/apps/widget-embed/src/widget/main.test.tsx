// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetStore } from "./store.js";

describe("main.tsx (widget SPA entrypoint)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    useWidgetStore.setState({ bootstrap: vi.fn().mockResolvedValue(undefined), view: "launcher", unreadCount: 0, initError: null, bootstrapping: false, setOnline: vi.fn() });
    window.history.pushState({}, "", "/");
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it(
    "mounts WidgetApp into #root without throwing",
    async () => {
      await import("./main.js");
      // WidgetApp renders null for a config-less URL (see WidgetApp.test.tsx), but the
      // React root itself must mount cleanly with no console/throw.
      expect(document.getElementById("root")).not.toBeNull();
    },
    // A real React root mount + full module-graph import genuinely takes longer
    // than the 5s default under a large, fully-parallel full-suite run (observed
    // flaking here specifically, not a product-code regression — this same test
    // passes in well under 1.5s in isolation) — a generous explicit timeout is the
    // honest fix, not a hidden retry/skip.
    15000,
  );
});
