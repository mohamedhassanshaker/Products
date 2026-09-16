import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { hasLocale } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Direction as DirectionPrimitive } from "radix-ui";
import { THEME_STYLE_ELEMENT_ID } from "@shj3/tokens";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "../../i18n/routing.js";
import { dbDirectionForLocale } from "../../i18n/locale-direction.js";
import { tryGetTenantContext } from "../../modules/platform/tenancy/tenant-context.js";
import { ResolveTheme } from "../../modules/theming/application/resolve-theme.js";
import { serializeResolvedTheme } from "../../modules/theming/application/serialize-resolved-theme.js";
import { NullThemeRepository } from "../../modules/theming/adapters/outbound/null-theme-repository.js";
import { PrismaThemeRepository } from "../../modules/theming/adapters/outbound/sql/prisma-theme-repository.js";
import {
  PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER,
  PREFERS_COLOR_SCHEME_COOKIE_NAME,
} from "../../modules/theming/domain/prefers-dark.js";
import type { DbDirection } from "../../modules/theming/domain/theme.js";
import "../globals.css";

/**
 * Locale-scoped root layout — the one place the resolved theme is inlined
 * server-side, and the one place `dir`/`lang` are set for the whole app.
 *
 * ADR-0007 makes the inlined stylesheet a security boundary, not styling: the
 * stylesheet is built with `serializeResolvedTheme` and written into `<head>`
 * before the page ships, so there is no flash of default theme and no
 * per-tenant branding is ever fetched client-side — which is what stops one
 * government entity's branding leaking into another's page through a shared
 * cache (design-system.md §9.4).
 *
 * ## Real resolution (theming backend wave, 2026-09-09), and its one honest gap
 *
 * `resolveTheme()`'s user -> tenant -> system merge (§9.4) is fully wired here.
 * The one thing NOT fully real yet: nothing in this codebase currently binds a
 * `TenantContext` for an ordinary page request — `middleware.ts` only
 * negotiates the locale; resolving a tenant from a citizen-facing channel is
 * B-6, and wiring staff session resolution (`AuthMiddleware`, already built —
 * `modules/iam/adapters/inbound/auth-middleware.ts` — but framework-agnostic
 * and meant to be driven by a route wrapper, not a shared root layout) into the
 * App Router is B-2. Both are unbuilt, so `tryGetTenantContext()` below
 * currently always returns `undefined` for a plain page load, which correctly
 * and safely resolves to pure system-default via `NullThemeRepository` (see
 * that file's own doc comment) — the exact "every tenant with no tenant
 * branding" path §9.3 already documents, not a special case invented for this
 * gap. The day either B-2 or B-6 binds a real context upstream of this layout,
 * resolution here starts using it with zero changes to this file.
 *
 * `globals.css` (Tailwind's build-time theme mapping, §3.4) and this file's
 * server-injected `<style id="shj3-theme">` (the runtime token *values*)
 * compose safely regardless of import or DOM order: Tailwind wraps every rule
 * it generates in a named `@layer`, and a named layer always loses to an
 * unlayered rule at equal specificity — this style tag is unlayered by
 * construction, so it always wins the cascade (verified against
 * tailwindcss@4.3.3).
 *
 * `[locale]` replaces the app-root layout that used to live at
 * `app/layout.tsx` (design-system.md §11.2, next-intl's App Router routing
 * recipe): every *page* now renders under a locale segment, which is what
 * lets `dir`/`lang` be resolved server-side, once, from the URL rather than
 * guessed at or toggled client-side. `app/api/healthz` sits outside this tree
 * on purpose — route handlers don't consume a layout, so it is unaffected.
 *
 * ## `DirectionProvider` — closing the gap the molecules wave found
 *
 * The B-1 molecules wave (see `tasks/todo.md`'s Wave 3A entry, and
 * `components/ui/use-resolved-dir.ts`) proved by reading
 * `@radix-ui/react-direction`'s actual source that `Tabs`/`ToggleGroup`/
 * `Slider` resolve their internal arrow-key/value direction via
 * `useDirection(localDir) { return localDir || useContext(DirectionContext)
 * || "ltr" }` — and that with no `DirectionProvider` anywhere in this app,
 * `DirectionContext` was always `undefined`, so every one of those primitives
 * silently defaulted to `"ltr"` unless a component manually re-derived and
 * passed `dir` itself (the per-component interim fix those three components
 * still carry, and still need — see below).
 *
 * `dir` is already resolved server-side, right here, before any HTML is
 * sent — so this is the one place that value can be handed to Radix's own
 * context instead of every consumer re-deriving it client-side after the
 * fact. Wrapping `children` in the real `<Direction.Provider dir={dir}>`
 * means every *future* Radix primitive with an internal direction concern
 * gets the right answer from context automatically, and — the concrete
 * improvement over the interim fix — the very first server-rendered paint is
 * already correct on a cold RTL load: there is no client-only
 * guess-then-correct frame, because nothing has to wait for an effect to
 * read `document.documentElement.dir` after mount.
 *
 * This is purely additive: `use-resolved-dir.ts` (consumed by `SubTabBar`,
 * `ToggleRow`, `Slider`) and `tooltip.tsx`'s `resolvePhysicalSide` are left
 * exactly as they are, deliberately not simplified to Radix's own
 * `useDirection()` in this change. Both are still correct and still needed:
 * `resolvePhysicalSide` translates a *logical* `side` prop to Radix
 * Popper's physical one, which is a floating-ui placement concern
 * `DirectionProvider` has no bearing on at all (confirmed in `tooltip.tsx`'s
 * own doc comment — `@radix-ui/react-popper` never reads `DirectionContext`).
 * `use-resolved-dir.ts` could now be rewritten in terms of
 * `Direction.useDirection()`, but doing so is a separate, narrow simplification
 * left for whichever wave next touches those three files, not a
 * side effect of wiring the provider itself.
 *
 * ## `NextIntlClientProvider` — added for the SkinEditor organism (2026-09-09)
 *
 * `SkinEditor` is the first Client Component in this app carrying enough user-facing
 * text (dozens of labels across five editing sections, dialogs, and the skin
 * manager) that threading each string down as an individual prop from its Server
 * Component page would mean an unwieldy, ever-growing prop surface rather than the
 * `useTranslations()` hook next-intl itself is built for. `useTranslations()` in a
 * Client Component requires a `NextIntlClientProvider` ancestor — absent until now,
 * since no prior wave needed client-side translation — so it is wired here, once, at
 * the same place `dir`/`DirectionProvider` already are: the root layout is the one
 * place a per-request value (here, `messages`) is already resolved before any client
 * boundary starts. `getMessages()` reads the SAME request-scoped messages object
 * `i18n/request.ts`'s `getRequestConfig` already loaded for this request's SSR pass
 * (via next-intl's own internal request cache) — no second file read, no second
 * source of truth. Purely additive: every Server Component's existing
 * `getTranslations()` usage (e.g. `settings/appearance/reset/page.tsx`) is completely
 * unaffected, since that API does not depend on this provider at all.
 */

/** Pre-renders both locales' routes at build time rather than only on demand. */
export function generateStaticParams(): Array<{ locale: string }> {
  return routing.locales.map((locale) => ({ locale }));
}

export type AppLocale = (typeof routing.locales)[number];

/**
 * Resolves the theme once per request, shared between `generateMetadata` (needs
 * `theme.appTitle`) and the layout component itself (needs everything else) —
 * `cache()` is React's own documented mechanism for exactly this "two entry points,
 * one request, one result" case, keyed on the arguments given (`locale`), which is
 * safe here because `headers()`/`cookies()`/`tryGetTenantContext()` are already
 * identical across both call sites within one request.
 *
 * No bound `TenantContext` exists today for any real request (see the file's own
 * doc comment) — `NullThemeRepository` resolves to pure system default via the same
 * code path a bound-but-unbranded tenant already uses. Once B-2/B-6 bind a context
 * upstream of this layout, `context.principal?.id` starts flowing into
 * `resolveTheme()` for free.
 */
export const resolveThemeForRequest = cache(async (locale: AppLocale) => {
  const localeDirection: DbDirection = dbDirectionForLocale(locale);

  const context = tryGetTenantContext();
  const repo = context ? new PrismaThemeRepository() : new NullThemeRepository();

  const [headersList, cookieStore] = await Promise.all([headers(), cookies()]);
  return new ResolveTheme(repo).execute({
    staffUserId: context?.principal?.id ?? null,
    localeDirection,
    prefersDarkSignal: {
      clientHint: headersList.get(PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER),
      cookie: cookieStore.get(PREFERS_COLOR_SCHEME_COOKIE_NAME)?.value ?? null,
    },
  });
});

/**
 * `theme.appTitle` is per-tenant (white-labelling — design-system.md §9.1's "App
 * title" control), so this must be `generateMetadata`, not a static `export const
 * metadata` — a static export cannot vary per request, and this layout's whole
 * point is that the app title does. A locale invalid enough that the layout below
 * will 404 it still needs *some* metadata returned here; falling back to the
 * shipped default's own app title rather than resolving a theme for a request that
 * is about to 404 anyway.
 *
 * `theme.faviconUrl` (§9.1's "favicon (upload -> assetId)" control, wired for
 * real by the brand-asset-upload wave) rides the identical mechanism — and
 * therefore inherits the identical, already-documented gap this file's own doc
 * comment above names for `appTitle`/colours/every other tenant-tier field: no
 * `TenantContext` is bound for an ordinary page load today, so `resolveThemeForRequest`
 * resolves via `NullThemeRepository` and `theme.faviconUrl` is always `null` on a
 * ordinary request, regardless of what a tenant has actually uploaded. Confirmed
 * live, not assumed: a real, successful appearance Save (a genuinely new,
 * unique `appTitle`) did not change `document.title` on the very next ordinary
 * `/command-centre` load in the same signed-in session. Real, correctly-wired
 * code with no live effect until B-2/B-6 close this gap — exactly the same
 * honest gap this file already named, not a new one.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const description = "Sharjah government-services assistant and backoffice";
  if (!hasLocale(routing.locales, locale)) {
    return { title: "SHJ3", description };
  }
  const theme = await resolveThemeForRequest(locale);
  return {
    title: theme.appTitle,
    description,
    // §9.1's Brand section: a tenant-uploaded favicon (`theme.faviconUrl`) wins
    // over Next's own default `/favicon.ico` convention — `icons` accepts a bare
    // URL string as shorthand for the default icon (Next's own documented
    // `Metadata.icons` shape), so no manual `<link rel="icon">` is needed in the
    // layout body below. `undefined` (key omitted) when nothing has been
    // uploaded falls through to whatever `app/favicon.ico`/Next's own default
    // resolution already provides, unaffected by this branch.
    ...(theme.faviconUrl ? { icons: theme.faviconUrl } : {}),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // The `[locale]` segment is effectively a catch-all for unknown top-level
  // paths (e.g. a typo'd `/xx`); the middleware only negotiates *known*
  // locales, but a request that bypasses it (a direct fetch, a stale link)
  // must not fall through to an invalid `lang`/`dir`.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [theme, messages] = await Promise.all([resolveThemeForRequest(locale), getMessages()]);

  // The resolved direction (a user or tenant override can win over the locale's own
  // default — §9.1's "Direction override" control) drives both `dir` and Radix's
  // DirectionProvider; `theme.mode`/`theme.density` are the `data-*` attributes
  // §9.4 requires so a single attribute change repaints everything.
  const dir = theme.direction === "RTL" ? "rtl" : "ltr";
  const stylesheet = serializeResolvedTheme(theme, { minify: true });

  return (
    <html lang={locale} dir={dir} data-theme={theme.mode} data-density={theme.density}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* The one sanctioned use of dangerouslySetInnerHTML in this app: a
            server-generated stylesheet whose values are validated by
            assertSafeCssValue at emit time (css.ts, via serializeResolvedTheme),
            never client input — true even though theme.colorTokens is itself a
            merge of tenant/user data, which is exactly the defence-in-depth §9.4
            calls for. */}
        <style id={THEME_STYLE_ELEMENT_ID} dangerouslySetInnerHTML={{ __html: stylesheet }} />
      </head>
      <body>
        <DirectionPrimitive.Provider dir={dir}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {/* Every real `Tooltip` (`components/ui/tooltip.tsx`, design-system.md §5.3 #20)
                has always required a `TooltipProvider` ancestor to actually render — that
                atom shipped fully built and tested long before this wave, but the provider
                itself was never mounted anywhere in the app (that file's own doc comment
                named it explicitly as "a later wave's job"). This is that wave: the field
                help-icon tooltips in the Flow Designer's node dialog are the first real
                consumer. */}
            <TooltipProvider>{children}</TooltipProvider>
          </NextIntlClientProvider>
        </DirectionPrimitive.Provider>
      </body>
    </html>
  );
}
