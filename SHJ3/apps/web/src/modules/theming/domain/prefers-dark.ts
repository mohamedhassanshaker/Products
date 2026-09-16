/**
 * Resolving `mode: "system"` needs a real signal for the request's OS-level colour
 * scheme preference (design-system.md §9.4).
 *
 * §9.4's own snippet references `principal.prefersDark`. Checked directly against the
 * real `Principal` type (`modules/platform/tenancy/tenant-context.ts`) before writing
 * this: no such field exists there, and nothing else in the current session/request
 * model carries it either — that reference in the doc was aspirational, not something
 * this build already has. A fabricated signal (e.g. sniffing the User-Agent, or just
 * hardcoding light) was rejected; this is the real, buildable-today replacement.
 *
 * Two real signals, in priority order, both honestly scoped:
 *
 *  1. The `Sec-CH-Prefers-Color-Scheme` request header — a real, standards-based
 *     Client Hint (not invented for this project), sent automatically by supporting
 *     browsers (Chromium-family, as of this build's knowledge) once the server has
 *     advertised interest via `Accept-CH` / `Critical-CH` response headers (wired in
 *     `next.config.ts`). Reads `"dark"` or `"light"`. Absent on a genuinely first-ever
 *     visit to the origin — the browser has not yet been told to send it — but present
 *     on every subsequent navigation once the response headers have been seen once.
 *  2. A `shj3-prefers-color-scheme` cookie, checked second, for browsers that do not
 *     implement the client hint (Firefox, Safari) or a true first visit. **Nothing in
 *     this backend wave writes this cookie** — that requires a client-side
 *     `matchMedia('(prefers-color-scheme: dark)')` read on first paint, which is a UI
 *     concern for whichever wave builds the Appearance module's client bootstrap.
 *     Reading it here, ahead of time, means that wave only has to start writing the
 *     cookie — resolution is already wired to notice it.
 *
 * Neither present -> `false` (light), matching the shipped light skin's own default.
 * This function is pure: reading the actual header/cookie happens in the root layout
 * (an `app/` file, which is allowed to import `next/headers`), never here.
 */
export interface PrefersDarkSignal {
  readonly clientHint: string | null;
  readonly cookie: string | null;
}

export function resolvePrefersDark(signal: PrefersDarkSignal): boolean {
  if (signal.clientHint === "dark") return true;
  if (signal.clientHint === "light") return false;
  if (signal.cookie === "dark") return true;
  if (signal.cookie === "light") return false;
  return false;
}

/**
 * The two real header/cookie names, exported so every reader (currently just the
 * root layout) shares one spelling. `next.config.ts`'s `Accept-CH`/`Critical-CH`
 * wiring intentionally does NOT import this — its own doc comment explains why
 * (Next's config-file loader has no NodeNext `.js`-to-`.ts` extension resolution) —
 * and keeps a literal copy of `PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER`'s value
 * instead; keep the two in sync if this ever changes.
 */
export const PREFERS_COLOR_SCHEME_CLIENT_HINT_HEADER = "sec-ch-prefers-color-scheme";
export const PREFERS_COLOR_SCHEME_COOKIE_NAME = "shj3-prefers-color-scheme";
