// QA round-5: (A) the deliberate side-effect dev disclosed -- /internal/xps/../ops/tenants now
// renders for an AUTHORIZED operator because Next consults the matcher before ".." normalization.
// The claim to verify: the DENIED side of that same spelling is unchanged (uniform 404), so this
// is only a routing convenience for an already-authorized operator, never a way for an
// unauthorized caller to distinguish gated-from-missing.
// (B) API-side Defect 1 regression: /api/internal/ops/** vs /api/[...unmatched], now that
// middleware runs on /api too.
import { raw, sig, GOOD_COOKIE, ALLOW_XFF } from "./lib.mjs";

const DENY = [
  ["DENY-unconfigured", 3491, {}],
  ["DENY-unconf+token", 3491, { cookie: GOOD_COOKIE }],
  ["DENY-noproxy-spoofXFF", 3493, ALLOW_XFF],
  ["DENY-proxy-badip", 3492, { "x-forwarded-for": "198.51.100.7" }],
  ["DENY-proxy-noip", 3492, {}],
];
const ALLOW = ["ALLOW-operator", 3492, Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE })];

console.log("=== (A) '..'-normalized path spellings: denied side must stay uniform ===");
const DOTDOT = [
  ["dotdot ops/tenants", "/internal/xps/../ops/tenants", "/internal/xps/../zzz/tenants"],
  ["dotdot ops/login", "/internal/xps/../ops/login", "/internal/xps/../zzz/login"],
  ["dotdot ops root", "/internal/xps/../ops", "/internal/xps/../zzz"],
  ["dotdot ops deep", "/internal/xps/../ops/tenants/new", "/internal/xps/../zzz/tenants/new"],
  ["dotdot into secret", "/internal/xps/../ops/nb-c-4f21c8a7e3d9b605/tenants", "/internal/xps/../ops/nb-c-0000000000000000/tenants"],
  ["dotdot x2", "/internal/a/b/../../internal/ops/tenants", "/internal/a/b/../../internal/zzz/tenants"],
  ["encoded dotdot", "/internal/xps/%2e%2e/ops/tenants", "/internal/xps/%2e%2e/zzz/tenants"],
  ["dot segment", "/internal/ops/./tenants", "/internal/zzz/./tenants"],
];
let dev = 0;
for (const [name, opsPath, missPath] of DOTDOT) {
  const sigs = new Map();
  for (const [cname, port, hdrs] of DENY) {
    const a = await raw(port, "GET", opsPath, hdrs);
    const b = await raw(port, "GET", missPath, hdrs);
    // normalize the path echoed by any redirect Location header
    const norm = (r, p) => r.status + "|" + r.headers.map((h) => h.split(p).join("<P>")).join(" ~ ") + "|" + (r.status >= 300 && r.status < 400 ? "<redirect>" : r.hash);
    const sa = norm(a, opsPath), sb = norm(b, missPath);
    if (!sigs.has(sa + " ||VS|| " + sb)) sigs.set(sa + " ||VS|| " + sb, []);
    sigs.get(sa + " ||VS|| " + sb).push(cname + (sa === sb ? " SAME" : " DIFFER"));
    if (sa !== sb) {
      dev++;
      console.log("  !! DENIED-SIDE DEVIATION " + name + " [" + cname + "]");
      console.log("       ops    : " + sa.slice(0, 240));
      console.log("       missing: " + sb.slice(0, 240));
    }
  }
  const r = await raw(ALLOW[1], "GET", opsPath, ALLOW[2]);
  const rw = (r.headers.find((h) => /^x-middleware-rewrite:/i.test(h)) || "no-rewrite").slice(0, 80);
  console.log("  " + name.padEnd(22) + " denied-side: " + (dev === 0 ? "uniform" : "see above") + " | ALLOWED operator -> status=" + r.status + " len=" + String(r.len).padEnd(7) + rw);
}
console.log("  denied-side deviations across " + DOTDOT.length + " shapes x " + DENY.length + " caller states: " + dev);

console.log("");
console.log("=== (B) API-side: /api/internal/ops/** vs /api/[...unmatched], all methods/states ===");
const API_PAIRS = [
  ["/api/internal/ops/tenants", "/api/internal/xps/tenants"],
  ["/api/internal/ops", "/api/internal/xps"],
  ["/api/internal/ops/tenants/abc", "/api/internal/xps/tenants/abc"],
  ["/api/internal/ops/session", "/api/internal/xps/session"],
  ["/api/internal/ops/nb-c-4f21c8a7e3d9b605/tenants", "/api/internal/ops/nb-c-0000000000000000/tenants"],
];
let apidev = 0, apichecked = 0;
for (const [opsP, missP] of API_PAIRS) {
  for (const method of ["GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    for (const [cname, port, hdrs] of [...DENY, ALLOW.length ? ["ALLOW-operator", ALLOW[1], ALLOW[2]] : null].filter(Boolean)) {
      const a = await raw(port, method, opsP, hdrs);
      const b = await raw(port, method, missP, hdrs);
      apichecked++;
      if (sig(a) !== sig(b)) {
        apidev++;
        console.log("  !! API DEVIATION " + method + " " + opsP + " [" + cname + "]");
        console.log("       ops    : " + sig(a).slice(0, 240));
        console.log("       missing: " + sig(b).slice(0, 240));
      }
    }
  }
}
console.log("  api pairs checked: " + apichecked + "; deviations: " + apidev);
const g = await raw(3491, "GET", "/api/internal/ops/tenants");
console.log("  sample: " + g.status + " len=" + g.len + " body=" + JSON.stringify(g.text.slice(0, 60)) + " hdrs=" + g.headers.join(" ~ ").slice(0, 200));
