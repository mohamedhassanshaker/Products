// TEST 2b/2e: exotic request shapes, middleware-bypass attempts, and matcher-gap
// fail-closed verification. For every shape: (a) is the DENIED response identical to the
// genuinely-missing baseline? (b) what does an ALLOWED caller get (to detect matcher gaps
// and confirm they fail closed rather than open)?
import http from "node:http";
import crypto from "node:crypto";

const VOLATILE = new Set(["date", "connection", "keep-alive", "content-length", "etag"]);
const STRICT_VOLATILE = new Set(["date", "connection", "keep-alive"]);
const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";
const GOOD_COOKIE = "nb_ops_session=test-operator-token-abc123";

function raw(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const rh = res.rawHeaders;
        const ordered = [];
        for (let i = 0; i < rh.length; i += 2) {
          if (!STRICT_VOLATILE.has(rh[i].toLowerCase())) ordered.push(rh[i] + ": " + rh[i + 1]);
        }
        resolve({ status: res.statusCode, headers: ordered, hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16), len: body.length, snippet: body.toString("utf8").slice(0, 160) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
const sig = (r) => r.status + "|" + r.headers.join(" ~ ") + "|" + r.hash;

// Baseline: genuinely-missing paths, from a denied caller.
const BASE = await raw(3491, "GET", "/internal/xps/tenants", {});
const BASE2 = await raw(3491, "GET", "/definitely-nothing-here-at-all", {});
console.log("baseline missing #1: " + sig(BASE).slice(0, 200));
console.log("baseline missing #2: " + sig(BASE2).slice(0, 200));
console.log("baselines agree: " + (sig(BASE) === sig(BASE2)));

const SHAPES = [
  ["trailing-slash", "/internal/ops/tenants/"],
  ["trailing-slash-root", "/internal/ops/"],
  ["double-slash-lead", "//internal/ops/tenants"],
  ["double-slash-mid", "/internal//ops/tenants"],
  ["uppercase", "/INTERNAL/OPS/TENANTS"],
  ["mixedcase", "/Internal/Ops/Tenants"],
  ["dot-segment", "/internal/ops/./tenants"],
  ["dotdot-escape", "/internal/xps/../ops/tenants"],
  ["encoded-slash", "/internal/ops%2Ftenants"],
  ["encoded-dot", "/internal/ops/%2e%2e/ops/tenants"],
  ["encoded-full", "/%69nternal/%6fps/tenants"],
  ["semicolon-param", "/internal/ops/tenants;a=b"],
  ["query", "/internal/ops/tenants?x=1&y=2"],
  ["hash-ish", "/internal/ops/tenants%23frag"],
  ["txt-suffix", "/internal/ops/tenants.txt"],
  ["rsc-suffix-caps", "/internal/ops/tenants.RSC"],
  ["deep-nest", "/internal/ops/a/b/c/d/e/f"],
  ["null-byte", "/internal/ops/tenants%00"],
  ["unicode", "/internal/ops/tenants%e2%80%8b"],
  ["backslash", "/internal/ops\\tenants"],
  ["internal-exact", INTERNAL],
  ["internal-trailing-slash", INTERNAL + "/"],
  ["internal-encoded", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants"],
  ["internal-uppercase", "/internal/ops/NB-C-4F21C8A7E3D9B605/tenants"],
  ["static-chunk-dir", "/_next/static/chunks/app/internal/ops/"],
  ["static-chunk-dir-secret", "/_next/static/chunks/app/internal/ops/nb-c-4f21c8a7e3d9b605/"],
  ["static-chunk-file-guess", "/_next/static/chunks/app/internal/ops/nb-c-4f21c8a7e3d9b605/login/page-9fd18ace14cebee3.js"],
  ["robots", "/robots.txt"],
  ["sitemap", "/sitemap.xml"],
];

const HEADER_ATTACKS = [
  ["none", {}],
  ["mw-subrequest-CVE-2025-29927", { "x-middleware-subrequest": "middleware" }],
  ["mw-subrequest-chain", { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }],
  ["mw-subrequest-src", { "x-middleware-subrequest": "src/middleware" }],
  ["forged-rewrite-hdr", { "x-middleware-rewrite": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-rewritten-path", { "x-nextjs-rewritten-path": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-invoke-path", { "x-invoke-path": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-nexturl", { "next-url": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-mw-override", { "x-middleware-override-headers": "x-nb-ops-denied", "x-nb-ops-denied": "1" }],
  ["router-state-tree", { "next-router-state-tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22internal%22%5D%7D%5D", RSC: "1" }],
  ["router-prefetch", { "next-router-prefetch": "1", RSC: "1" }],
  ["segment-prefetch", { "next-router-segment-prefetch": "/_tree", RSC: "1" }],
  ["mw-prefetch", { "x-middleware-prefetch": "1" }],
  ["forged-xff-plus-subrequest", { "x-forwarded-for": "203.0.113.5", "x-middleware-subrequest": "middleware" }],
];

console.log("\n=== (a) DENIED-side uniformity across exotic shapes x header attacks (port 3491 unconfigured, 3493 configured-noproxy) ===");
let deviations = 0, checked = 0;
for (const [sname, path] of SHAPES) {
  for (const [hname, hdrs] of HEADER_ATTACKS) {
    for (const port of [3491, 3493]) {
      const r = await raw(port, "GET", path, hdrs);
      checked++;
      const same = sig(r) === sig(BASE);
      const isStatic = path.startsWith("/_next/static") || sname === "robots" || sname === "sitemap";
      if (!same) {
        deviations++;
        console.log((isStatic ? "[non-ops path] " : "!! DEVIATION ") + sname + " / " + hname + " / p" + port + " -> " + sig(r).slice(0, 230));
      }
    }
  }
}
console.log("checked " + checked + " denied responses; deviations from missing-baseline: " + deviations);

console.log("\n=== (b) ALLOWED-side behaviour per shape (matcher coverage; 404 = matcher gap = fail closed) ===");
for (const [sname, path] of SHAPES) {
  const r = await raw(3492, "GET", path, { "x-forwarded-for": "203.0.113.5", cookie: GOOD_COOKIE });
  const rewrite = r.headers.find((h) => /^x-middleware-rewrite/i.test(h)) || "no-rewrite";
  const sameAsMissing = sig(r) === sig(BASE);
  console.log("  " + sname.padEnd(28) + " status=" + r.status + " len=" + r.len + " " + rewrite.slice(0, 90) + (sameAsMissing ? "  [identical to genuine 404 => fail-closed]" : ""));
}

console.log("\n=== (c) does bypassing middleware expose the console at the secret path? ===");
for (const [hname, hdrs] of HEADER_ATTACKS) {
  const r = await raw(3491, "GET", INTERNAL + "/tenants", hdrs);
  const r2 = await raw(3493, "GET", INTERNAL + "/tenants", hdrs);
  const flag = (x) => (x.status === 200 ? "*** 200 CONSOLE REACHED ***" : "" + x.status);
  console.log("  " + hname.padEnd(30) + " unconf=" + flag(r) + " len=" + r.len + " | conf-noproxy=" + flag(r2) + " len=" + r2.len + (sig(r) === sig(BASE) ? " [==genuine404]" : " [!=genuine404]"));
}
