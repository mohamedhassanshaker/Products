// Indistinguishability matrix for the NFR-11 page-surface defect.
// Groups every response by (status + ordered header block + body hash) and reports how many
// distinct signatures exist across the gated set and the genuinely-missing set combined.
import http from "node:http";
import crypto from "node:crypto";

const DENIED_PORT = 3491; // ops env entirely unconfigured
const CONFIGURED_PORT = 3492; // configured; allowlist 203.0.113.0/24; trusted proxy 127.0.0.1
const BUILD_ID = process.argv[2];
const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";

const VOLATILE = new Set(["date", "connection", "keep-alive"]);

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
          if (!VOLATILE.has(raw[i].toLowerCase())) ordered.push(`${raw[i]}: ${raw[i + 1]}`);
        }
        resolve({
          status: res.statusCode,
          headers: ordered,
          bodyHash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16),
          bodyLen: body.length,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// --- request shapes -------------------------------------------------------------------
const SUFFIXES = ["", ".rsc", ".json", ".segments/__PAGE__.segment.rsc"];
function shapes(base) {
  const out = [];
  for (const s of SUFFIXES) {
    out.push({ shape: `suffix:${s || "plain"}`, path: base + s });
    out.push({ shape: `nextdata+suffix:${s || "plain"}`, path: `/_next/data/${BUILD_ID}${base}${s}` });
    out.push({ shape: `nextdata-any+suffix:${s || "plain"}`, path: `/_next/data/ANY-SEG${base}${s}` });
  }
  return out;
}

// Gated (must be indistinguishable) and genuinely-missing counterparts of matching depth.
const GATED = ["/internal/ops", "/internal/ops/login", "/internal/ops/tenants", "/internal/ops/tenants/new", "/internal/ops/tenants/abc"];
const MISSING = ["/internal/xps", "/internal/xps/login", "/internal/xps/tenants", "/internal/xps/tenants/new", "/internal/xps/tenants/abc"];
const NEAR_MISS = ["/internal", "/internal/op", "/internal/opsx", "/internal/ops-x", "/internal/opsy/tenants"];
const INTERNAL_PROBE = [INTERNAL, `${INTERNAL}/tenants`, `${INTERNAL}/login`];

// --- caller contexts (every denial reason) --------------------------------------------
const BOGUS_COOKIE = "nb_ops_session=deadbeef.deadbeef; other=1";
const CONTEXTS = [
  { name: "unconfigured", port: DENIED_PORT, headers: {} },
  { name: "unconfigured+forged-denied-header", port: DENIED_PORT, headers: { "x-nb-ops-denied": "1" } },
  { name: "unconfigured+bogus-session", port: DENIED_PORT, headers: { cookie: BOGUS_COOKIE } },
  { name: "unconfigured+spoofed-xff-allowed-ip", port: DENIED_PORT, headers: { "x-forwarded-for": "203.0.113.5" } },
  { name: "configured-unresolvable-ip", port: CONFIGURED_PORT, headers: {} },
  { name: "configured-disallowed-ip", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "198.51.100.7" } },
  { name: "configured-disallowed-via-trusted-hop", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "198.51.100.7, 127.0.0.1" } },
  { name: "configured-disallowed-multi-hop", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "198.51.100.7, 127.0.0.1, 127.0.0.1" } },
  { name: "configured-all-hops-trusted", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "127.0.0.1, 127.0.0.1" } },
  { name: "configured-unparseable-hop", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "not-an-ip" } },
  { name: "configured-realip-disallowed", port: CONFIGURED_PORT, headers: { "x-real-ip": "198.51.100.7" } },
  { name: "configured-bogus-session-disallowed-ip", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "198.51.100.7", cookie: BOGUS_COOKIE } },
  { name: "configured-forged-denied-header-disallowed-ip", port: CONFIGURED_PORT, headers: { "x-forwarded-for": "198.51.100.7", "x-nb-ops-denied": "1" } },
];

const METHODS = ["GET", "HEAD", "POST", "OPTIONS", "PUT", "DELETE"];

const results = [];
async function run() {
  for (const ctx of CONTEXTS) {
    for (const [group, bases] of [
      ["gated", GATED],
      ["missing", MISSING],
      ["near-miss", NEAR_MISS],
      ["internal-probe", INTERNAL_PROBE],
    ]) {
      for (const base of bases) {
        for (const { shape, path } of shapes(base)) {
          for (const rsc of [false, true]) {
            for (const method of METHODS) {
              // Keep the run bounded: exercise every method only on the plain shape;
              // exercise every shape with GET (both RSC flavours).
              if (method !== "GET" && shape !== "suffix:plain") continue;
              const headers = { ...ctx.headers, ...(rsc ? { RSC: "1" } : {}) };
              const res = await request(ctx.port, method, path, headers);
              results.push({ ctx: ctx.name, group, base, shape, path, method, rsc, ...res });
            }
          }
        }
      }
    }
  }

  // Compare like-for-like: a response may legitimately differ by request shape/method
  // (a HEAD has no body, an RSC request gets a component payload), so the signature set is
  // computed per (method, shape, rsc) bucket. Within a bucket, gated and genuinely-missing
  // paths must be indistinguishable.
  const buckets = new Map();
  for (const r of results) {
    if (r.group === "internal-probe") continue;
    const key = `${r.method}|${r.shape}|rsc=${r.rsc}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  let failures = 0;
  for (const [key, rows] of buckets) {
    const sigs = new Map();
    for (const r of rows) {
      const sig = `${r.status}\n${r.headers.join("\n")}\n${r.bodyHash}`;
      if (!sigs.has(sig)) sigs.set(sig, []);
      sigs.get(sig).push(r);
    }
    if (sigs.size !== 1) {
      failures++;
      console.log(`\n### DISTINGUISHABLE (${sigs.size} signatures) in bucket ${key}`);
      for (const [sig, rows2] of sigs) {
        console.log(`--- signature (${rows2.length} responses), e.g. ${rows2[0].ctx} ${rows2[0].method} ${rows2[0].path}`);
        console.log(sig.split("\n").map((l) => "    " + l).join("\n"));
        console.log("    groups: " + [...new Set(rows2.map((r) => r.group))].join(","));
        console.log("    sample paths: " + [...new Set(rows2.map((r) => r.path))].slice(0, 6).join(" "));
      }
    } else {
      const [sig] = [...sigs.keys()];
      const first = sig.split("\n")[0];
      console.log(`OK  ${key.padEnd(52)} ${rows.length} responses, 1 signature, status ${first}, body ${rows[0].bodyLen}B/${rows[0].bodyHash}`);
    }
  }

  console.log(`\nTotal responses: ${results.length}; buckets: ${buckets.size}; distinguishable buckets: ${failures}`);

  // Report the internal-prefix probe separately (documented residual).
  console.log("\n### internal-prefix probe (documented residual)");
  const seen = new Set();
  for (const r of results.filter((x) => x.group === "internal-probe" && x.method === "GET" && !x.rsc)) {
    const sig = `${r.status}|${r.headers.join(" ~ ")}|${r.bodyHash}`;
    if (seen.has(r.ctx + r.shape)) continue;
    seen.add(r.ctx + r.shape);
    if (r.shape !== "suffix:plain") continue;
    console.log(`  ${r.ctx} ${r.path} -> ${r.status} body=${r.bodyLen}B/${r.bodyHash} extra=${r.headers.filter((h) => /middleware|rewritten/i.test(h)).join(",") || "none"}`);
  }
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
