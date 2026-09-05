import http from "node:http";
import crypto from "node:crypto";

const P_UNCONF = 3491;
const P_PROXY = 3492;
const P_NOPROXY = 3493;
const BUILD_ID = process.argv[2];
const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";
const VOLATILE = new Set(["date", "connection", "keep-alive"]);

function request(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
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
        resolve({
          status: res.statusCode,
          headers: ordered,
          bodyHash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16),
          bodyLen: body.length,
          ms: Number(process.hrtime.bigint() - t0) / 1e6,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const SUFFIXES = ["", ".rsc", ".json", ".segments/__PAGE__.segment.rsc"];
function shapes(base) {
  const out = [];
  for (const s of SUFFIXES) {
    out.push({ shape: "suffix:" + (s || "plain"), path: base + s });
    out.push({ shape: "nextdata+suffix:" + (s || "plain"), path: "/_next/data/" + BUILD_ID + base + s });
    out.push({ shape: "nextdata-any+suffix:" + (s || "plain"), path: "/_next/data/ANY-SEG" + base + s });
  }
  return out;
}

const GATED = ["/internal/ops", "/internal/ops/login", "/internal/ops/tenants", "/internal/ops/tenants/new", "/internal/ops/tenants/abc"];
const MISSING = ["/internal/xps", "/internal/xps/login", "/internal/xps/tenants", "/internal/xps/tenants/new", "/internal/xps/tenants/abc"];
const NEAR_MISS = ["/internal", "/internal/op", "/internal/opsx", "/internal/ops-x", "/internal/opsy/tenants", INTERNAL + "x", INTERNAL + "x/tenants"];
const INTERNAL_PROBE = [INTERNAL, INTERNAL + "/login", INTERNAL + "/tenants", INTERNAL + "/tenants/new", INTERNAL + "/nope"];

const BOGUS_COOKIE = "nb_ops_session=deadbeef.deadbeef; other=1";
const GOOD_COOKIE = "nb_ops_session=test-operator-token-abc123";
const ALLOW_XFF = { "x-forwarded-for": "203.0.113.5" };

const DENIED = [
  { name: "unconfigured", port: P_UNCONF, headers: {} },
  { name: "unconfigured+forged-x-nb-ops-denied", port: P_UNCONF, headers: { "x-nb-ops-denied": "1" } },
  { name: "unconfigured+bogus-session", port: P_UNCONF, headers: { cookie: BOGUS_COOKIE } },
  { name: "unconfigured+valid-token-cookie", port: P_UNCONF, headers: { cookie: GOOD_COOKIE } },
  { name: "unconfigured+spoofed-xff-allowed-ip", port: P_UNCONF, headers: ALLOW_XFF },
  { name: "noproxy-spoofed-xff-allowed-ip", port: P_NOPROXY, headers: ALLOW_XFF },
  { name: "noproxy-spoofed-realip-allowed-ip", port: P_NOPROXY, headers: { "x-real-ip": "203.0.113.5" } },
  { name: "noproxy-spoofed-xff+valid-token", port: P_NOPROXY, headers: Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE }) },
  { name: "noproxy-no-headers", port: P_NOPROXY, headers: {} },
  { name: "proxy-unresolvable-ip", port: P_PROXY, headers: {} },
  { name: "proxy-disallowed-ip", port: P_PROXY, headers: { "x-forwarded-for": "198.51.100.7" } },
  { name: "proxy-disallowed-via-trusted-hop", port: P_PROXY, headers: { "x-forwarded-for": "198.51.100.7, 127.0.0.1" } },
  { name: "proxy-disallowed-multi-hop", port: P_PROXY, headers: { "x-forwarded-for": "198.51.100.7, 127.0.0.1, 127.0.0.1" } },
  { name: "proxy-all-hops-trusted", port: P_PROXY, headers: { "x-forwarded-for": "127.0.0.1, 127.0.0.1" } },
  { name: "proxy-unparseable-hop", port: P_PROXY, headers: { "x-forwarded-for": "not-an-ip" } },
  { name: "proxy-realip-disallowed", port: P_PROXY, headers: { "x-real-ip": "198.51.100.7" } },
  { name: "proxy-bogus-session-disallowed-ip", port: P_PROXY, headers: { "x-forwarded-for": "198.51.100.7", cookie: BOGUS_COOKIE } },
  { name: "proxy-forged-denied-header-disallowed-ip", port: P_PROXY, headers: { "x-forwarded-for": "198.51.100.7", "x-nb-ops-denied": "1" } },
  { name: "proxy-xff-just-below-allowlist", port: P_PROXY, headers: { "x-forwarded-for": "203.0.112.255" } },
];
const ALLOWED = [
  { name: "ALLOWED-ip-no-session", port: P_PROXY, headers: ALLOW_XFF },
  { name: "ALLOWED-ip-valid-session", port: P_PROXY, headers: Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE }) },
  { name: "ALLOWED-ip-bogus-session", port: P_PROXY, headers: Object.assign({}, ALLOW_XFF, { cookie: BOGUS_COOKIE }) },
];

const METHODS = ["GET", "HEAD", "POST", "OPTIONS", "PUT", "DELETE"];
const results = [];

async function sweep(contexts, groups) {
  for (const ctx of contexts) {
    for (const [group, bases] of groups) {
      for (const base of bases) {
        for (const s of shapes(base)) {
          for (const rsc of [false, true]) {
            for (const method of METHODS) {
              if (method !== "GET" && s.shape !== "suffix:plain") continue;
              const headers = Object.assign({}, ctx.headers, rsc ? { RSC: "1" } : {});
              const res = await request(ctx.port, method, s.path, headers);
              results.push(Object.assign({ ctx: ctx.name, group, base, shape: s.shape, path: s.path, method, rsc }, res));
            }
          }
        }
      }
    }
  }
}

function bucketCheck(rows, label) {
  const buckets = new Map();
  for (const r of rows) {
    const key = r.method + "|" + r.shape + "|rsc=" + r.rsc;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  let failures = 0;
  for (const [key, list] of buckets) {
    const sigs = new Map();
    for (const r of list) {
      const sig = r.status + "\n" + r.headers.join("\n") + "\n" + r.bodyHash;
      if (!sigs.has(sig)) sigs.set(sig, []);
      sigs.get(sig).push(r);
    }
    if (sigs.size !== 1) {
      failures++;
      console.log("\n### " + label + ": DISTINGUISHABLE (" + sigs.size + " signatures) in bucket " + key);
      for (const [sig, rows2] of sigs) {
        console.log("--- signature (" + rows2.length + " responses) e.g. " + rows2[0].ctx + " " + rows2[0].method + " " + rows2[0].path);
        console.log(sig.split("\n").map((l) => "    " + l).join("\n"));
        console.log("    groups: " + [...new Set(rows2.map((r) => r.group))].join(","));
        console.log("    ctxs: " + [...new Set(rows2.map((r) => r.ctx))].slice(0, 8).join(","));
        console.log("    sample: " + [...new Set(rows2.map((r) => r.path))].slice(0, 6).join(" "));
      }
    } else {
      console.log("OK  " + label + " " + key.padEnd(50) + " " + list.length + " resp, 1 sig, status " + [...sigs.keys()][0].split("\n")[0] + ", body " + list[0].bodyLen + "B/" + list[0].bodyHash);
    }
  }
  console.log("\n" + label + ": " + rows.length + " responses, " + buckets.size + " buckets, " + failures + " distinguishable");
  return failures;
}

async function run() {
  await sweep(DENIED, [["gated", GATED], ["missing", MISSING], ["near-miss", NEAR_MISS], ["internal-probe", INTERNAL_PROBE]]);
  await sweep(ALLOWED, [["internal-probe", INTERNAL_PROBE], ["missing", MISSING]]);

  console.log("=== TEST 1: denial vs genuinely-missing (all denial reasons, all shapes) ===");
  const f1 = bucketCheck(results.filter((r) => ["gated", "missing", "near-miss"].includes(r.group) && !r.ctx.startsWith("ALLOWED")), "denied-vs-missing");

  console.log("\n=== TEST 2a: internal secret-segment probe - gate independence (allowed vs denied) ===");
  const probe = results.filter((r) => r.group === "internal-probe");
  const f2 = bucketCheck(probe, "internal-probe");
  const bySig = new Map();
  for (const r of probe.filter((x) => x.shape === "suffix:plain" && x.method === "GET" && !x.rsc)) {
    const sig = r.status + "|" + r.headers.join(" ~ ") + "|" + r.bodyHash;
    if (!bySig.has(sig)) bySig.set(sig, new Set());
    bySig.get(sig).add(r.ctx + " @ " + r.path);
  }
  console.log("\ninternal-probe plain-GET distinct signatures: " + bySig.size);
  for (const [sig, ctxs] of bySig) {
    const cs = [...ctxs];
    console.log("  sig: " + sig.slice(0, 300));
    console.log("    entries=" + cs.length + " allowed=" + cs.filter((c) => c.startsWith("ALLOWED")).length + " denied=" + cs.filter((c) => !c.startsWith("ALLOWED")).length);
  }

  console.log("\n=== internal-probe vs genuine-404 difference (documented residual) ===");
  const g404 = results.find((r) => r.group === "missing" && r.shape === "suffix:plain" && r.method === "GET" && !r.rsc);
  const p404 = results.find((r) => r.group === "internal-probe" && r.shape === "suffix:plain" && r.method === "GET" && !r.rsc);
  console.log("  genuine 404 headers: " + JSON.stringify(g404.headers));
  console.log("  internal-probe hdrs: " + JSON.stringify(p404.headers));
  console.log("  same body hash: " + (g404.bodyHash === p404.bodyHash) + " " + g404.bodyHash + " " + p404.bodyHash + " status " + g404.status + "/" + p404.status);

  console.log("\nTOTAL responses: " + results.length + "; failures: test1=" + f1 + " test2a=" + f2);
  if (f1 || f2) process.exitCode = 1;
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
