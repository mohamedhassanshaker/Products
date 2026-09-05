import { useEffect, useMemo } from "react";
import { TooltipProvider } from "@nextbot/ui/components/ui/tooltip";
import { useWidgetStore } from "./store.js";
import { resolveDirection } from "./direction.js";
import { Launcher } from "./components/Launcher.js";
import { WidgetWindow } from "./components/WidgetWindow.js";
import { buildWidgetBrandStyleTag } from "./theme.js";
import type { WidgetEmbedConfig } from "./types.js";
import "./globals.css";

const COLLAPSED_SIZE = { width: "64px", height: "64px" };
const EXPANDED_SIZE = { width: "380px", height: "560px" };

function decodeConfig(): WidgetEmbedConfig | null {
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get("tenantId");
  const channelId = params.get("channelId");
  if (!tenantId || !channelId) return null;

  const encoded = params.get("config");
  let extra: Partial<WidgetEmbedConfig> = {};
  if (encoded) {
    try {
      const binary = atob(encoded);
      const json = decodeURIComponent(
        Array.from(binary)
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      );
      extra = JSON.parse(json);
    } catch {
      extra = {};
    }
  }
  return { tenantId, channelId, ...extra };
}

/** Posts the iframe's desired geometry to the loader (`nextbot-loader.ts`'s
 * `nextbot:resize` listener) — the *only* thing the outer host page ever learns
 * about the widget's state. */
function postResize(state: "collapsed" | "expanded") {
  const size = state === "collapsed" ? COLLAPSED_SIZE : EXPANDED_SIZE;
  window.parent.postMessage({ type: "nextbot:resize", state, ...size }, "*");
}

export function WidgetApp() {
  const config = useMemo(() => decodeConfig(), []);
  const { bootstrap, view, setOnline, language, channelTheme } = useWidgetStore();

  // Runs once on mount only — `config` is derived once (above) from the URL and
  // never changes for the lifetime of this iframe document, and `bootstrap` is a
  // stable Zustand action reference.
  useEffect(() => {
    if (config) void bootstrap(config);
  }, [bootstrap, config]);

  useEffect(() => {
    postResize(view === "window" ? "expanded" : "collapsed");
  }, [view]);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [setOnline]);

  // D4 fix (QA fix pass, carried forward through the shadcn migration): the
  // tenant's saved brand color (`channelTheme`, resolved server-side from
  // `branding_config` during `bootstrap()`) is the *default* theme — a per-embed
  // `config.theme` override (this widget's own decoded URL config) still takes
  // final precedence over it wherever both specify a field. Before this fix, only
  // `config.theme` was ever read here, so a tenant's brand color was silently
  // dropped for every embed that didn't also pass an explicit per-embed override
  // (i.e. almost every real embed).
  const brandStyle = useMemo(
    () =>
      buildWidgetBrandStyleTag({
        primaryColor: config?.theme?.primaryColor ?? channelTheme?.primaryColor,
        fontFamily: config?.theme?.fontFamily ?? channelTheme?.fontFamily,
      }),
    [config?.theme?.primaryColor, config?.theme?.fontFamily, channelTheme?.primaryColor, channelTheme?.fontFamily],
  );
  const fontFamily = config?.theme?.fontFamily ?? channelTheme?.fontFamily;

  // D7 fix (QA fix pass): re-derived from the *live* `language` store state on
  // every render (not computed once from the static embed config) so switching
  // languages in the Language Selection Modal actually mirrors the layout for an
  // RTL language — see `resolveDirection`'s doc comment for the precedence rule
  // and this fix's documented scope (dir-mirroring only, not a translation
  // dictionary).
  const dir = resolveDirection(config?.direction, language);

  // FR-OC-01: a genuinely missing tenantId/channelId is caught client-side by the
  // loader before this iframe is even created — this is defense-in-depth for the
  // (should-not-happen) case of a directly-loaded widget URL missing them. Every
  // hook above must still run unconditionally on every render (Rules of Hooks),
  // hence this early return comes last.
  if (!config) return null;

  return (
    <TooltipProvider>
      {/* Plan Phase 5: the CSS-custom-property `<style>`-injection pattern
          `apps/web`'s `build-brand-style-tag.ts` established for SSR'd per-tenant
          branding, adapted here for this widget's client-rendered-only context (no
          SSR step exists for a Vite SPA) — a plain child text node is sufficient
          (no `dangerouslySetInnerHTML` needed since this isn't interpolated into a
          server-rendered HTML string), and it still applies before the rest of the
          tree paints since it's the first child rendered. */}
      <style>{brandStyle}</style>
      <div dir={dir} style={fontFamily ? { fontFamily } : undefined}>
        {view === "launcher" ? <Launcher /> : <WidgetWindow />}
      </div>
    </TooltipProvider>
  );
}
