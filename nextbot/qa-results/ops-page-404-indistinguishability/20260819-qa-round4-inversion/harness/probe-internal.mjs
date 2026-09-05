// TEST 2a (focused): for each (path, shape, method, rsc), are the internal-secret-segment
// responses IDENTICAL across every caller/auth state (allowed vs denied)? Any variation
// keyed on authorization would be a new oracle.
import http from "node:http";
import crypto from "node:crypto";

const BUILD_ID = process.argv[2];
const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";
const VOLATILE = new Set(["date", "connection", "keep-alive"]);
const GOOD_COOKIE = "nb_ops_session=test-operator-token-abc123";
const ALLOW_XFF = { "x-forwarded-for": "203.0.113.5" };

const CONTEXTS = [
  { name: "DENY-unconfigured", port: 3491, headers: {} },
  { name: "DENY-unconf+token", port: 3491, headers: { cookie: GOOD_COOKIE } },
  { name: "DENY-noproxy-spoof", port: 3493, headers: ALLOW_XFF },
  { name: "DENY-proxy-badip", port: 3492, headers: { "x-forwarded-for": "198.51.100.7" } },
  { name: "DENY-proxy-noip", port: 3492, headers: {} },
  { name: "ALLOW-ip-nosession", port: 3492, headers: ALLOW_XFF },
  { name: "ALLOW-ip-session", port: 3492, headers: Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE }) },
  { name: "ALLOW-ip-badsession", port: 3492, headers: Object.assign({}, ALLOW_XFF, { cookie: "nb_ops_session=deadbeef" }) },
];

function request(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const raw = res.rawHeaders;
        const ordered = [];
        for (let i = 0; i < raw.length; i += 2) {
          if (!VOLATILE.has(raw[i].toLowerCase())) ordered.push(raw[i] + ": " + raw[i + 1]);
        }
        resolve({ status: res.statusCode, headers: ordered, hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16), len: body.length });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const BASES = [INTERNAL, INTERNAL + "/login", INTERNAL + "/tenants", INTERNAL + "/tenants/new", INTERNAL + "/tenants/abc", INTERNAL + "/nope", INTERNAL + "/(console)/tenants"];
const SUFFIXES = ["", ".rsc", ".json", ".segments/__PAGE__.segment.rsc"];
const METHODS = ["GET", "HEAD", "POST", "OPTIONS", "PUT", "DELETE"];

let cases = 0, bad = 0;
for (const base of BASES) {
  const variants = [];
  for (const s of SUFFIXES) {
    variants.push(base + s);
    variants.push("/_next/data/" + BUILD_ID + base + s);
    variants.push("/_next/data/ANY-SEG" + base + s);
  }
  for (const path of variants) {
    for (const rsc of [false, true]) {
      for (const method of METHODS) {
        if (method !== "GET" && !path.endsWith(base)) continue;
        const sigs = new Map();
        for (const ctx of CONTEXTS) {
          const h = Object.assign({}, ctx.headers, rsc ? { RSC: "1" } : {});
          const r = await request(ctx.port, method, path, h);
          const sig = r.status + "|" + r.headers.join(" ~ ") + "|" + r.hash;
          if (!sigs.has(sig)) sigs.set(sig, []);
          sigs.get(sig).push(ctx.name);
        }
        cases++;
        if (sigs.size !== 1) {
          bad++;
          console.log("\n!! GATE-DEPENDENT at " + method + " " + path + " rsc=" + rsc + " (" + sigs.size + " sigs)");
          for (const [sig, ctxs] of sigs) console.log("   [" + ctxs.join(",") + "] => " + sig.slice(0, 260));
        }
      }
    }
  }
}
console.log("\ninternal-prefix gate-independence: " + cases + " (path,shape,method,rsc) cases x " + CONTEXTS.length + " caller states; gate-dependent cases: " + bad);
