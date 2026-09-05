import { FormatRegistry } from "@sinclair/typebox";

/**
 * TypeBox's `format` keyword (used on `Type.String({ format: "email" })` etc.
 * throughout this package) validates nothing at all unless the format name is
 * explicitly registered — an unregistered format makes `Value.Check` **fail closed**
 * with "Unknown format" (discovered the hard way: a real `POST /connectors` request
 * with a perfectly valid `https://` URL was rejected until this was added). Registered
 * once, here, so every schema in this package that uses `format: "email"` / `"uri"`
 * actually validates instead of silently rejecting everything.
 *
 * Deliberately minimal, dependency-free regexes — not a full RFC 5322/3986 validator,
 * consistent with this project's "no unvalidated jsonb writes" bar (structurally
 * reasonable, not exhaustively pedantic) rather than pulling in a new dependency for
 * format checking alone.
 */
if (!FormatRegistry.Has("email")) {
  FormatRegistry.Set("email", (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}
if (!FormatRegistry.Has("uri")) {
  FormatRegistry.Set("uri", (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  });
}
// UUID shape check (8-4-4-4-12 hex digits, hyphenated), case-insensitive. Every
// `Type.String({ format: "uuid" })` field across this package's schemas (primary/
// foreign key fields on nearly every resource) relied on this being registered; left
// unregistered, `Value.Check` fails closed for every value — including genuinely valid
// UUIDs — the same way "email"/"uri" did before they were added above.
//
// QA regression (fixed twice; this is the corrected version — see decision-log entry
// in docs/NEXUS_STATE.md dated 2026-08-15): the first version of this regex hard-coded
// the version nibble (13th hex digit) to `[1-5]`, i.e. an allowlist of RFC 4122
// versions 1 through 5. This codebase's own `generateId()` (packages/db/src/id.ts)
// generates **UUIDv7** (RFC 9562, formalized after RFC 4122) for every primary key in
// the system — version nibble `7` — which that allowlist rejected outright. Every real
// id this system produces failed validation on every field using `format: "uuid"`.
//
// Fix: validate the general UUID *shape* only, without constraining the version
// nibble to a fixed set — a hand-maintained version allowlist is exactly what caused
// this defect twice, and RFC 9562 has since formalized v6/v7/v8 with more versions
// plausible in the future. The variant nibble (17th hex digit, first char of the 4th
// group) is still constrained to `[89ab]`, matching the `uuid` npm package's own
// `validate()` regex and Node's `crypto.randomUUID()` output — that nibble encodes the
// RFC 4122/9562 "variant" (its top two bits fixed at `10`), which is far more stable
// across UUID versions than the version nibble is, so constraining it does not risk
// excluding any RFC-conformant UUID this system does or could produce.
if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
