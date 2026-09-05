// Partition every denied-side deviation from the plain-404 baseline into:
//   (a) requires already knowing the real secret segment -> the accepted round-4 residual class
//   (b) shape-inherent: identical to a paired non-ops control -> not an ops signal at all
// Anything in neither bucket is a genuine new leak.
import { raw, sig } from "./lib.mjs";
const SEG = "nb-c-4f21c8a7e3d9b605";
const REF = sig(await raw(3491, "GET", "/internal/xps/tenants"));
const INTERNAL_SIG_CLASS = "x-middleware-rewrite";
const SPELLINGS = process.argv.slice(2);
// read the deviating names from the previous run instead: recompute a compact list here
const CASES = [
  ["pubprefix-lc+tenants@0", "%2finternal/ops/tenants", "%2finternal/xps/tenants"],
  ["esc-secret-api", "/api/internal/o%70s/tenants", "/api/internal/x%70s/tenants"],
  ["ops-p-esc-nosecret", "/internal/o%70s/tenants", "/internal/x%70s/tenants"],
  ["double-pub", "/internal/o%2570s/" + SEG + "/tenants", "/internal/x%2570s/" + SEG + "/tenants"],
  ["dotdot-public", "/internal/xps/../ops/tenants", "/internal/xps/../zzz/tenants"],
  ["dotdot-public-login", "/internal/xps/../ops/login", "/internal/xps/../zzz/login"],
  ["malformed-lone-pct-pub", "/internal/%ops/" + SEG + "/tenants", "/internal/%xps/" + SEG + "/tenants"],
  ["double-orig", "/internal/ops/nb%252Dc%252D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%252Dc%252D0000000000000000/tenants"],
  ["triple-orig", "/internal/ops/nb%25252Dc%25252D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%25252Dc%25252D0000000000000000/tenants"],
  ["esc-dotdot(has secret)", "/internal/ops/zzz/%2e%2e/" + SEG + "/tenants", "/internal/xps/zzz/%2e%2e/" + SEG + "/tenants"],
];
console.log("REF plain-404 baseline: " + REF.slice(0, 120) + "...\n");
for (const [name, ops, ctl] of CASES) {
  const a = await raw(3491, "GET", ops);
  const b = await raw(3491, "GET", ctl);
  const hasSecret = ops.includes(SEG) || ops.includes("nb-c-4f21");
  console.log(name.padEnd(26) + " status=" + a.status +
    " ==baseline:" + String(sig(a) === REF).padEnd(6) +
    " ==pairedControl:" + String(sig(a) === sig(b)).padEnd(6) +
    " hasRewriteHdr:" + String(a.headers.some((h) => /^x-middleware-rewrite/i.test(h))).padEnd(6) +
    " needsSecret:" + hasSecret);
}
