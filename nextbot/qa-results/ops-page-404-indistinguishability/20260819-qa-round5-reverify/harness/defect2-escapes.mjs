// QA round-5, Defect 2 (promoted to blocking by dev's own re-analysis): percent-encoded
// spellings of the console paths. Dev claims Next decodes the pathname before route-matching
// while middleware sees the escapes, so an escaped spelling of the INTERNAL prefix used to slip
// past middleware neutralization and reach the REAL console route, stopped only by
// assertOpsPageAllowed() -- i.e. gate-DEPENDENT, not the gate-independent cache-header nit QA
// originally scoped it as.
//
// Deliberately exhaustive rather than exemplary: escape EVERY character position of
// "/internal/ops", every position of the secret segment and of the tail, plus double/triple
// escapes, mixed-case escapes, malformed escapes, escaped separators and traversal -- and for
// each spelling compare the response across all 8 caller/gate states. Any spelling whose
// response varies with the gate is an authorization oracle.
import { raw, sig, INTERNAL, GOOD_COOKIE, ALLOW_XFF } from "./lib.mjs";

const CONTEXTS = [
  { name: "DENY-unconfigured", port: 3491, headers: {} },
  { name: "DENY-unconf+token", port: 3491, headers: { cookie: GOOD_COOKIE } },
  { name: "DENY-noproxy-spoof", port: 3493, headers: ALLOW_XFF },
  { name: "DENY-noproxy-spoof+tok", port: 3493, headers: Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE }) },
  { name: "DENY-proxy-badip", port: 3492, headers: { "x-forwarded-for": "198.51.100.7" } },
  { name: "DENY-proxy-noip", port: 3492, headers: {} },
  { name: "ALLOW-ip-nosession", port: 3492, headers: ALLOW_XFF },
  { name: "ALLOW-ip-session", port: 3492, headers: Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE }) },
];

const enc = (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0");
const encU = (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase();
const dbl = (c) => "%25" + c.charCodeAt(0).toString(16).padStart(2, "0");

function singleCharEscapes(s, label, encoder) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push([label + "@" + i + "(" + s[i] + ")", s.slice(0, i) + encoder(s[i]) + s.slice(i + 1)]);
  return out;
}

const PUB = "/internal/ops";
const SEG = "nb-c-4f21c8a7e3d9b605";
const CASES = [];
CASES.push(["BASELINE plain-internal", INTERNAL + "/tenants"]);
CASES.push(["BASELINE plain-public", PUB + "/tenants"]);
CASES.push(["BASELINE genuinely-missing", "/internal/xps/tenants"]);

// (1) escape each char of the PUBLIC prefix
for (const [n, p] of singleCharEscapes(PUB, "pubprefix-lc", enc)) CASES.push([n + " +secret", p + "/" + SEG + "/tenants"]);
for (const [n, p] of singleCharEscapes(PUB, "pubprefix-lc", enc)) CASES.push([n + " +tenants", p + "/tenants"]);
for (const [n, p] of singleCharEscapes(PUB, "pubprefix-UC", encU)) CASES.push([n + " +secret", p + "/" + SEG + "/tenants"]);

// (2) escape each char of the SECRET segment
for (const [n, s] of singleCharEscapes(SEG, "secretseg-lc", enc)) CASES.push([n, PUB + "/" + s + "/tenants"]);
for (const [n, s] of singleCharEscapes(SEG, "secretseg-UC", encU)) CASES.push([n, PUB + "/" + s + "/tenants"]);

// (3) escape each char of the tail segment
for (const [n, t] of singleCharEscapes("tenants", "tail-lc", enc)) CASES.push([n, INTERNAL + "/" + t]);

// (4) the originally-reported spelling and neighbours
CASES.push(["orig-report-%2D-UCesc", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants"]);
CASES.push(["orig-report-%2d-lcesc", PUB + "/nb%2dc%2d4f21c8a7e3d9b605/tenants"]);
CASES.push(["every-char-escaped-secret", PUB + "/" + [...SEG].map(enc).join("") + "/tenants"]);
CASES.push(["every-char-escaped-pub", "/" + [..."internal"].map(enc).join("") + "/" + [..."ops"].map(enc).join("") + "/" + SEG + "/tenants"]);
CASES.push(["ops-p-escaped", "/internal/o%70s/" + SEG + "/tenants"]);
CASES.push(["ops-p-escaped-nosecret", "/internal/o%70s/tenants"]);

// (5) double / triple escapes
for (const [n, s] of singleCharEscapes(SEG, "secretseg-DOUBLE", dbl)) CASES.push([n, PUB + "/" + s + "/tenants"]);
CASES.push(["double-escape-orig", PUB + "/nb%252Dc%252D4f21c8a7e3d9b605/tenants"]);
CASES.push(["triple-escape-orig", PUB + "/nb%25252Dc%25252D4f21c8a7e3d9b605/tenants"]);
CASES.push(["double-escape-pub", "/internal/o%2570s/" + SEG + "/tenants"]);

// (6) malformed escapes (decodeURIComponent throws on these)
CASES.push(["malformed-trailing-pct", PUB + "/" + SEG + "/tenants%"]);
CASES.push(["malformed-pct-zz", PUB + "/" + SEG + "/tenants%zz"]);
CASES.push(["malformed-pct-2", PUB + "/" + SEG + "/tenants%2"]);
CASES.push(["malformed-in-secret", PUB + "/nb%2c%4-4f21c8a7e3d9b605/tenants"]);
CASES.push(["malformed-lone-pct-pub", "/internal/%ops/" + SEG + "/tenants"]);
CASES.push(["malformed-bad-utf8", PUB + "/" + SEG + "/%c3%28"]);
CASES.push(["malformed-truncated-utf8", PUB + "/" + SEG + "/%e2%80"]);
CASES.push(["malformed-plus-valid-escape", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants%"]);
CASES.push(["malformed-bad-utf8-in-secret", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605%c3/tenants"]);

// (7) escaped separators / traversal
CASES.push(["escaped-slash-before-secret", PUB + "%2F" + SEG + "/tenants"]);
CASES.push(["escaped-slash-after-secret", PUB + "/" + SEG + "%2Ftenants"]);
CASES.push(["escaped-slash-both", PUB + "%2F" + SEG + "%2Ftenants"]);
CASES.push(["escaped-dotdot-into-secret", PUB + "/zzz/%2e%2e/" + SEG + "/tenants"]);
CASES.push(["dotdot-into-secret", "/internal/xps/../ops/" + SEG + "/tenants"]);
CASES.push(["dotdot-into-public", "/internal/xps/../ops/tenants"]);
CASES.push(["dotdot-into-public-login", "/internal/xps/../ops/login"]);
CASES.push(["nullbyte-in-secret", PUB + "/" + SEG + "%00/tenants"]);
CASES.push(["nullbyte-after-tail", INTERNAL + "/tenants%00"]);

// (8) escaped spellings in the transport forms Next generates
CASES.push(["escaped-secret .rsc", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants.rsc"]);
CASES.push(["escaped-secret .json", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants.json"]);
CASES.push(["escaped-secret segments", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants.segments/__PAGE__.segment.rsc"]);
CASES.push(["escaped-secret root", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605"]);
CASES.push(["escaped-secret login", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/login"]);
CASES.push(["escaped-secret nonpage", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/definitely-not-a-page"]);
CASES.push(["escaped-secret tenants-new", PUB + "/nb%2Dc%2D4f21c8a7e3d9b605/tenants/new"]);
CASES.push(["escaped-secret api", "/api/internal/o%70s/tenants"]);

const CACHE_OF = (r) => (r.headers.find((h) => /^cache-control:/i.test(h)) || "cache-control: <absent>").toLowerCase();
const refMissing = await raw(3491, "GET", "/internal/xps/tenants");
const refInternal = await raw(3491, "GET", INTERNAL + "/tenants");
console.log("REF genuinely-missing : " + sig(refMissing).slice(0, 220));
console.log("REF plain-internal    : " + sig(refInternal).slice(0, 220));
console.log("");

let gateDependent = 0, consoleReached = 0, cacheOdd = 0, checked = 0;
const classes = new Map();
console.log("=== per-spelling: is the response GATE-DEPENDENT across " + CONTEXTS.length + " caller states? ===");
for (const [name, path] of CASES) {
  const sigs = new Map();
  let sample = null;
  for (const ctx of CONTEXTS) {
    const r = await raw(ctx.port, "GET", path, ctx.headers);
    sample = sample || r;
    if (r.status === 200) {
      consoleReached++;
      console.log("  *** STATUS 200 CONSOLE REACHED *** " + name + " [" + ctx.name + "] " + path);
    }
    const s = sig(r);
    if (!sigs.has(s)) sigs.set(s, []);
    sigs.get(s).push(ctx.name);
  }
  checked++;
  const cc = CACHE_OF(sample);
  const cls = sigs.size === 1 ? sig(sample) : "MULTI";
  if (!classes.has(cls)) classes.set(cls, []);
  classes.get(cls).push(name);
  if (sigs.size !== 1) {
    gateDependent++;
    console.log("");
    console.log("  !! GATE-DEPENDENT: " + name + "  path=" + path);
    for (const [s, ctxs] of sigs) console.log("       [" + ctxs.join(",") + "] => " + s.slice(0, 260));
  }
  if (!/no-store/.test(cc)) {
    cacheOdd++;
    console.log("  ~~ NON-no-store cache header: " + name.padEnd(34) + cc + "   " + path);
  }
}

console.log("");
console.log("=== summary ===");
console.log("spellings checked        : " + checked + " x " + CONTEXTS.length + " states = " + checked * CONTEXTS.length + " responses");
console.log("gate-dependent spellings : " + gateDependent);
console.log("spellings reaching the console (status 200): " + consoleReached);
console.log("spellings without Cache-Control no-store  : " + cacheOdd);
console.log("distinct response classes across spellings: " + classes.size);
for (const [s, names] of [...classes.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const tag = s === "MULTI" ? "MULTI (gate-dependent)" : s === sig(refMissing) ? "== genuinely-missing 404" : s === sig(refInternal) ? "== plain-internal 404 (accepted round-4 residual)" : "OTHER";
  console.log("  [" + String(names.length).padStart(3) + " spellings] " + tag);
  if (tag === "OTHER" || s === "MULTI") {
    console.log("        sig: " + s.slice(0, 320));
    console.log("        members: " + names.slice(0, 14).join(", ") + (names.length > 14 ? " ..." : ""));
  }
}
