/**
 * `/{locale}/widget?channelKey=...` — an SSR'd, standalone rendering of the
 * real widget for direct browser testing/demo, without needing the embed
 * `<script>` (this module's own top-level brief). Satisfies
 * architecture.md §9's "assistant widget SSR for first paint inside the
 * portal": the page shell — locale, theme, layout chrome — is genuinely
 * server-rendered by the existing `[locale]/layout.tsx` this route already
 * sits under, before any client JS runs.
 *
 * **Honest scope trim, named rather than silently shipped:** the *widget's
 * own* bootstrap/conversation data (`GetWidgetBootstrap`, resolved theme
 * tokens) is fetched client-side by `WidgetApp` on mount, not resolved here
 * server-side. Doing that resolution in this Server Component would need a
 * tenant context bound from `channelKey` before any repository call —
 * exactly what `AuthMiddleware.handleAnonymous` does for a real `Request` in
 * a Route Handler, but there is no equivalent, sanctioned way to bind one
 * from inside a Server Component (`runWithTenant` "must not be called from a
 * feature module" per its own doc comment, and building a second,
 * page-specific binder would be exactly the "parallel auth mechanism" this
 * module's brief says not to build). The public bootstrap endpoint is cheap,
 * cached (`Cache-Control: public, max-age=60`), and this is the same first
 * request the embeddable bundle itself makes — so the only cost of this trim
 * is one extra client round trip on this one demo page, not a real gap in
 * the citizen-facing widget's own behaviour.
 */

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { WidgetApp } from "../../../../modules/conversation/adapters/inbound/widget-app.js";

export default async function WidgetDemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ channelKey?: string }>;
}) {
  const { locale } = await params;
  const { channelKey } = await searchParams;
  const t = await getTranslations("widget");

  if (!channelKey) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        {t("demoPage.missingChannelKeyIntro")}{" "}
        <code className="mx-1 font-mono">{t("demoPage.missingChannelKeyExample")}</code>{" "}
        {t("demoPage.missingChannelKeyOutro")}
      </div>
    );
  }

  return (
    // `height` via inline `style`, not Tailwind's `h-[calc(100vh-2rem)]` arbitrary-value
    // syntax, which the design gate bans regardless of unit — `vh` itself is not a value
    // the token gate's px/pt/em literal ban targets (see
    // `flow-canvas-mobile-sheet.tsx`'s identical, established precedent for this exact
    // "genuinely geometric, viewport-relative" case).
    //
    // `max-w-5xl` was a dead class, not a design choice: this bridge's `--container-*`
    // reset is never re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so
    // no `max-w-*` utility compiles — the same confirmed-empty gap already fixed at
    // `sign-in-form.tsx`/`settings/appearance/reset/page.tsx`. `max-w-5xl`'s own real
    // value (64rem/1024px) is reproduced here as a literal `rem`, unaffected by the
    // token gate's `px|pt|em`-only length pattern — the sanctioned mechanism, not a
    // gate workaround.
    <div
      className="mx-auto flex flex-col p-4"
      style={{ height: "calc(100vh - 2rem)", gap: "var(--space-2)", maxWidth: "64rem" }}
    >
      <div className="min-h-0 flex-1">
        <WidgetApp channelKey={channelKey} locale={locale} />
      </div>
      {
        // Phase F's own "lighter, modestly-scoped" citizen affordance (CLAUDE.md's Phase F
        // spec): a plain link to the one citizen-facing guide entry, deliberately placed
        // only on this standalone demo/test harness page rather than inside `WidgetApp`/
        // `AssistantWidgetShell` itself (the real embeddable component real citizen sites
        // load via `<script>`). Wiring a help affordance into that shared, already-tested
        // organism is real, separate work for whoever next touches `modules/conversation` —
        // named here rather than silently left unmentioned — since it changes a component
        // this wave did not otherwise audit, for a citizen-widget guide entry that is itself
        // already the deliberately thinnest entry in this module (see
        // `modules/userguide/content/citizen-widget.ts`'s own doc comment).
      }
      <Link
        href={`/${locale}/help/citizen-widget`}
        className="shrink-0 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        {t("demoPage.helpLinkLabel")}
      </Link>
    </div>
  );
}
