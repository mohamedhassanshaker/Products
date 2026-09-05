// QA round-5, the decisive assertion for Defect 2. The companion probe flags any spelling whose
// response varies with the gate -- but gate-variance at the PUBLIC prefix is the intended design
// (an allowed operator reaches the console, everyone else gets the app ordinary 404). The
// security requirement is narrower, and this is the test of it:
//
//   For EVERY spelling, in EVERY denied caller state, is the response byte-identical both to the
//   genuinely-missing baseline AND to a paired non-ops control with the same escaping applied --
//   and does any spelling ever leak s-maxage or reach the console for a denied caller?
import { raw, sig, INTERNAL, GOOD_COOKIE, ALLOW_XFF } from "./lib.mjs";

const DENY = [
  ["DENY-unconfigured", 3491, {}],
  ["DENY-unconf+token", 3491, { cookie: GOOD_COOKIE }],
  ["DENY-noproxy-spoofXFF", 3493, ALLOW_XFF],
  ["DENY-noproxy-spoof+tok", 3493, Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE })],
  ["DENY-proxy-badip", 3492, { "x-forwarded-for": "198.51.100.7" }],
  ["DENY-proxy-noip", 3492, {}],
];

const enc = (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0");
const encU = (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase();
const dbl = (c) => "%25" + c.charCodeAt(0).toString(16).padStart(2, "0");
const SEG = "nb-c-4f21c8a7e3d9b605";
const DECOY = "nb-c-0000000000000000";
const PAIRS = [];

function pushPrefixEsc(label, tail, encoder) {
  const P = "/internal/ops", Q = "/internal/xps";
  for (let i = 0; i < P.length; i++) {
    PAIRS.push([label + "@" + i, P.slice(0, i) + encoder(P[i]) + P.slice(i + 1) + tail, Q.slice(0, i) + encoder(Q[i]) + Q.slice(i + 1) + tail]);
  }
}
pushPrefixEsc("pubprefix-lc+secret", "/" + SEG + "/tenants", enc);
pushPrefixEsc("pubprefix-lc+tenants", "/tenants", enc);
pushPrefixEsc("pubprefix-UC+secret", "/" + SEG + "/tenants", encU);

for (let i = 0; i < SEG.length; i++) {
  for (const [tag, e] of [["lc", enc], ["UC", encU], ["DBL", dbl]]) {
    PAIRS.push([
      "secretseg-" + tag + "@" + i,
      "/internal/ops/" + SEG.slice(0, i) + e(SEG[i]) + SEG.slice(i + 1) + "/tenants",
      "/internal/ops/" + DECOY.slice(0, i) + e(DECOY[i]) + DECOY.slice(i + 1) + "/tenants",
    ]);
  }
}
const T = "tenants";
for (let i = 0; i < T.length; i++) {
  PAIRS.push(["tail-lc@" + i, INTERNAL + "/" + T.slice(0, i) + enc(T[i]) + T.slice(i + 1), "/internal/ops/" + DECOY + "/" + T.slice(0, i) + enc(T[i]) + T.slice(i + 1)]);
}

const E = [
  ["orig-%2D", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%2Dc%2D0000000000000000/tenants"],
  ["orig-%2d", "/internal/ops/nb%2dc%2d4f21c8a7e3d9b605/tenants", "/internal/ops/nb%2dc%2d0000000000000000/tenants"],
  ["all-esc-secret", "/internal/ops/" + [...SEG].map(enc).join("") + "/tenants", "/internal/ops/" + [...DECOY].map(enc).join("") + "/tenants"],
  ["ops-p-esc", "/internal/o%70s/" + SEG + "/tenants", "/internal/x%70s/" + SEG + "/tenants"],
  ["ops-p-esc-nosecret", "/internal/o%70s/tenants", "/internal/x%70s/tenants"],
  ["double-orig", "/internal/ops/nb%252Dc%252D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%252Dc%252D0000000000000000/tenants"],
  ["triple-orig", "/internal/ops/nb%25252Dc%25252D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%25252Dc%25252D0000000000000000/tenants"],
  ["double-pub", "/internal/o%2570s/" + SEG + "/tenants", "/internal/x%2570s/" + SEG + "/tenants"],
  ["malformed-trail-pct", "/internal/ops/" + SEG + "/tenants%", "/internal/ops/" + DECOY + "/tenants%"],
  ["malformed-zz", "/internal/ops/" + SEG + "/tenants%zz", "/internal/ops/" + DECOY + "/tenants%zz"],
  ["malformed-pct2", "/internal/ops/" + SEG + "/tenants%2", "/internal/ops/" + DECOY + "/tenants%2"],
  ["malformed-in-secret", "/internal/ops/nb%2c%4-4f21c8a7e3d9b605/tenants", "/internal/ops/nb%2c%4-0000000000000000/tenants"],
  ["malformed-lone-pct-pub", "/internal/%ops/" + SEG + "/tenants", "/internal/%xps/" + SEG + "/tenants"],
  ["malformed-badutf8", "/internal/ops/" + SEG + "/%c3%28", "/internal/ops/" + DECOY + "/%c3%28"],
  ["malformed-truncutf8", "/internal/ops/" + SEG + "/%e2%80", "/internal/ops/" + DECOY + "/%e2%80"],
  ["malformed-plus-valid", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants%", "/internal/ops/nb%2Dc%2D0000000000000000/tenants%"],
  ["malformed-badutf8-secret", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605%c3/tenants", "/internal/ops/nb%2Dc%2D0000000000000000%c3/tenants"],
  ["esc-slash-before", "/internal/ops%2F" + SEG + "/tenants", "/internal/xps%2F" + SEG + "/tenants"],
  ["esc-slash-after", "/internal/ops/" + SEG + "%2Ftenants", "/internal/ops/" + DECOY + "%2Ftenants"],
  ["esc-slash-both", "/internal/ops%2F" + SEG + "%2Ftenants", "/internal/xps%2F" + SEG + "%2Ftenants"],
  ["esc-dotdot", "/internal/ops/zzz/%2e%2e/" + SEG + "/tenants", "/internal/xps/zzz/%2e%2e/" + SEG + "/tenants"],
  ["dotdot-secret", "/internal/xps/../ops/" + SEG + "/tenants", "/internal/xps/../ops/" + DECOY + "/tenants"],
  ["dotdot-public", "/internal/xps/../ops/tenants", "/internal/xps/../zzz/tenants"],
  ["dotdot-public-login", "/internal/xps/../ops/login", "/internal/xps/../zzz/login"],
  ["nullbyte-secret", "/internal/ops/" + SEG + "%00/tenants", "/internal/ops/" + DECOY + "%00/tenants"],
  ["nullbyte-tail", INTERNAL + "/tenants%00", "/internal/ops/" + DECOY + "/tenants%00"],
  ["esc-secret.rsc", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants.rsc", "/internal/ops/nb%2Dc%2D0000000000000000/tenants.rsc"],
  ["esc-secret.json", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants.json", "/internal/ops/nb%2Dc%2D0000000000000000/tenants.json"],
  ["esc-secret.segments", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants.segments/__PAGE__.segment.rsc", "/internal/ops/nb%2Dc%2D0000000000000000/tenants.segments/__PAGE__.segment.rsc"],
  ["esc-secret-root", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605", "/internal/ops/nb%2Dc%2D0000000000000000"],
  ["esc-secret-login", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/login", "/internal/ops/nb%2Dc%2D0000000000000000/login"],
  ["esc-secret-nonpage", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/nope", "/internal/ops/nb%2Dc%2D0000000000000000/nope"],
  ["esc-secret-api", "/api/internal/o%70s/tenants", "/api/internal/x%70s/tenants"],
];
PAIRS.push(...E);

const refMissing = await raw(3491, "GET", "/internal/xps/tenants");
const REF = sig(refMissing);
console.log("REF genuinely-missing 404 sig: " + REF.slice(0, 200));
console.log("spellings: " + PAIRS.length + " x " + DENY.length + " denied caller states\n");

let n = 0, notPairEqual = 0, notRefEqual = 0, deniedVaries = 0, smaxage = 0, reached200 = 0;
const pairFail = [], refFail = [], variesFail = [];
for (const [name, opsP, ctlP] of PAIRS) {
  const deniedSigs = new Set();
  for (const [cname, port, hdrs] of DENY) {
    const a = await raw(port, "GET", opsP, hdrs);
    const b = await raw(port, "GET", ctlP, hdrs);
    n++;
    if (a.status === 200) { reached200++; console.log("  *** DENIED CALLER GOT 200 *** " + name + " [" + cname + "] " + opsP); }
    if (/s-maxage/i.test(a.headers.join(" "))) { smaxage++; console.log("  *** s-maxage LEAK *** " + name + " [" + cname + "] " + a.headers.find((h) => /cache-control/i.test(h))); }
    deniedSigs.add(sig(a));
    if (sig(a) !== sig(b)) { notPairEqual++; pairFail.push(name); }
    if (sig(a) !== REF) { notRefEqual++; refFail.push(name); }
  }
  if (deniedSigs.size !== 1) { deniedVaries++; variesFail.push(name); }
}
console.log("=== DENIED-SIDE RESULTS ===");
console.log("denied responses captured                             : " + n * 2);
console.log("denied caller ever got 200 (console reached)           : " + reached200);
console.log("denied caller ever got an s-maxage cache header        : " + smaxage);
console.log("spellings whose denied response varies by caller state : " + deniedVaries + (variesFail.length ? "  -> " + [...new Set(variesFail)].join(", ") : ""));
console.log("denied ops response != paired non-ops control          : " + notPairEqual + (pairFail.length ? "  -> " + [...new Set(pairFail)].join(", ") : ""));
console.log("denied ops response != genuinely-missing baseline      : " + notRefEqual + (refFail.length ? "  -> " + [...new Set(refFail)].join(", ") : ""));
