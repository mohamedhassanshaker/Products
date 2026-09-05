// TEST 2b (corrected): per-shape PAIRWISE comparison. Each exotic shape is requested in an
// ops form and in a genuinely-missing form built by substituting the prefix, so shape-inherent
// behaviour (e.g. Next's trailing-slash 308) cancels out and only ops-specific deviation shows.
import http from "node:http";
import crypto from "node:crypto";

const STRICT_VOLATILE = new Set(["date", "connection", "keep-alive"]);
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
        resolve({ status: res.statusCode, headers: ordered, hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16), len: body.length });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
// Normalize away the one thing that MUST differ between a pair: the path echoed in a
// redirect Location/Refresh header (a 308 for /a/ -> /a names the requested path by
// definition, for every path in the app).
function sig(r, opsPath, missPath) {
  const hs = r.headers.map((h) => h.split(opsPath).join("<PATH>").split(missPath).join("<PATH>"));
  return r.status + "|" + hs.join(" ~ ") + "|" + (r.status >= 300 && r.status < 400 ? "<redirect-body>" : r.hash);
}

// [name, opsForm, missingForm]
const PAIRS = [
  ["plain", "/internal/ops/tenants", "/internal/xps/tenants"],
  ["trailing-slash", "/internal/ops/tenants/", "/internal/xps/tenants/"],
  ["trailing-slash-root", "/internal/ops/", "/internal/xps/"],
  ["double-slash-lead", "//internal/ops/tenants", "//internal/xps/tenants"],
  ["double-slash-mid", "/internal//ops/tenants", "/internal//xps/tenants"],
  ["uppercase", "/INTERNAL/OPS/TENANTS", "/INTERNAL/XPS/TENANTS"],
  ["mixedcase", "/Internal/Ops/Tenants", "/Internal/Xps/Tenants"],
  ["dot-segment", "/internal/ops/./tenants", "/internal/xps/./tenants"],
  ["dotdot-escape", "/internal/zzz/../ops/tenants", "/internal/zzz/../xps/tenants"],
  ["encoded-slash", "/internal/ops%2Ftenants", "/internal/xps%2Ftenants"],
  ["encoded-dotdot", "/internal/ops/%2e%2e/ops/tenants", "/internal/xps/%2e%2e/xps/tenants"],
  ["encoded-letters", "/%69nternal/%6fps/tenants", "/%69nternal/%78ps/tenants"],
  ["semicolon-param", "/internal/ops/tenants;a=b", "/internal/xps/tenants;a=b"],
  ["query", "/internal/ops/tenants?x=1&y=2", "/internal/xps/tenants?x=1&y=2"],
  ["encoded-hash", "/internal/ops/tenants%23frag", "/internal/xps/tenants%23frag"],
  ["txt-suffix", "/internal/ops/tenants.txt", "/internal/xps/tenants.txt"],
  ["rsc-suffix-caps", "/internal/ops/tenants.RSC", "/internal/xps/tenants.RSC"],
  ["rsc-suffix", "/internal/ops/tenants.rsc", "/internal/xps/tenants.rsc"],
  ["json-suffix", "/internal/ops/tenants.json", "/internal/xps/tenants.json"],
  ["segments-suffix", "/internal/ops/tenants.segments/__PAGE__.segment.rsc", "/internal/xps/tenants.segments/__PAGE__.segment.rsc"],
  ["deep-nest", "/internal/ops/a/b/c/d/e/f", "/internal/xps/a/b/c/d/e/f"],
  ["null-byte", "/internal/ops/tenants%00", "/internal/xps/tenants%00"],
  ["zero-width", "/internal/ops/tenants%e2%80%8b", "/internal/xps/tenants%e2%80%8b"],
  ["backslash", "/internal/ops\\tenants", "/internal/xps\\tenants"],
  ["root-prefix-only", "/internal/ops", "/internal/xps"],
  ["nextdata", "/_next/data/49-BgB3sVoY_555HfmnuU/internal/ops/tenants.json", "/_next/data/49-BgB3sVoY_555HfmnuU/internal/xps/tenants.json"],
  ["nextdata-anyseg", "/_next/data/ANY/internal/ops/tenants.json", "/_next/data/ANY/internal/xps/tenants.json"],
  ["secret-seg-vs-decoy", "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants", "/internal/ops/nb-c-0000000000000000/tenants"],
  ["secret-seg-uppercase", "/internal/ops/NB-C-4F21C8A7E3D9B605/tenants", "/internal/ops/NB-C-0000000000000000/tenants"],
  ["secret-seg-encoded", "/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants", "/internal/ops/nb%2Dc%2D0000000000000000/tenants"],
  ["secret-seg-plus-json", "/internal/ops/nb-c-4f21c8a7e3d9b605.json", "/internal/ops/nb-c-0000000000000000.json"],
];

const HEADER_ATTACKS = [
  ["none", {}],
  ["mw-subrequest", { "x-middleware-subrequest": "middleware" }],
  ["mw-subrequest-chain", { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" }],
  ["forged-rewrite-hdr", { "x-middleware-rewrite": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-rewritten-path", { "x-nextjs-rewritten-path": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-invoke-path", { "x-invoke-path": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-nexturl", { "next-url": "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants" }],
  ["forged-x-nb-ops-denied", { "x-nb-ops-denied": "1" }],
  ["forged-mw-override", { "x-middleware-override-headers": "x-nb-ops-denied", "x-nb-ops-denied": "1" }],
  ["rsc", { RSC: "1" }],
  ["rsc-prefetch", { RSC: "1", "next-router-prefetch": "1" }],
  ["rsc-segment-prefetch", { RSC: "1", "next-router-segment-prefetch": "/_tree" }],
  ["rsc-state-tree", { RSC: "1", "next-router-state-tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22internal%22%5D%7D%5D" }],
  ["mw-prefetch", { "x-middleware-prefetch": "1" }],
];

console.log("=== (a) DENIED: ops-shape vs missing-shape, pairwise ===");
let dev = 0, checked = 0;
const devNames = [];
for (const [name, opsP, missP] of PAIRS) {
  for (const [hname, hdrs] of HEADER_ATTACKS) {
    for (const port of [3491, 3493]) {
      const a = await raw(port, "GET", opsP, hdrs);
      const b = await raw(port, "GET", missP, hdrs);
      checked++;
      const sa = sig(a, opsP, missP), sb = sig(b, opsP, missP);
      if (sa !== sb) {
        dev++;
        devNames.push(name + "/" + hname + "/p" + port);
        console.log("!! DEVIATION " + name + " / " + hname + " / p" + port);
        console.log("     ops    : " + sa.slice(0, 240));
        console.log("     missing: " + sb.slice(0, 240));
      }
    }
  }
}
console.log("pairs checked: " + checked + "; deviations: " + dev);

console.log("\n=== (b) ALLOWED-side per shape (does the matcher reach it? 404==fail-closed) ===");
for (const [name, opsP] of PAIRS) {
  const r = await raw(3492, "GET", opsP, { "x-forwarded-for": "203.0.113.5", cookie: GOOD_COOKIE });
  const rw = (r.headers.find((h) => /^x-middleware-rewrite/i.test(h)) || "no-rewrite-header").slice(0, 95);
  console.log("  " + name.padEnd(24) + " status=" + String(r.status).padEnd(4) + " len=" + String(r.len).padEnd(7) + rw);
}

console.log("\n=== (c) middleware-bypass attempts against the secret path (does the console render?) ===");
for (const [hname, hdrs] of HEADER_ATTACKS) {
  const p = "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants";
  const a = await raw(3491, "GET", p, hdrs);
  const b = await raw(3493, "GET", p, hdrs);
  const c = await raw(3492, "GET", p, Object.assign({ "x-forwarded-for": "203.0.113.5", cookie: GOOD_COOKIE }, hdrs));
  const f = (x) => x.status + "/" + x.len + (x.status === 200 ? " *** CONSOLE RENDERED ***" : "");
  console.log("  " + hname.padEnd(24) + " unconf=" + f(a) + " | conf-noproxy=" + f(b) + " | allowed-operator=" + f(c));
}
