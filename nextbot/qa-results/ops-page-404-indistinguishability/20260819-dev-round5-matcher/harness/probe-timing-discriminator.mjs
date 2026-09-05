// Round 5: the "which prefix is the real one?" ranking probe QA used to identify the ops
// prefix by latency (timing-matcher-discriminator.txt). Interleaved samples over a set of
// paths that are all 404s, only one family of which is the real console prefix. If the fix
// works, the p50 ordering is noise — the ops rows must not sort to the top.
//
// Extra rows vs QA's version: an /api path and a _next/data transport form, so a *new*
// narrower class boundary introduced by broadening the matcher would show up here too.
import http from "node:http";

const PORT = Number(process.argv[2] ?? 3491);
const BUILD_ID = process.argv[3] ?? "build-id-unknown";
const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";

function timeit(p) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.request({ port: PORT, host: "127.0.0.1", method: "GET", path: p }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    req.on("error", reject);
    req.end();
  });
}
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const PATHS = [
  ["/internal/ops/tenants", "GATED"],
  ["/internal/ops", "GATED root"],
  [INTERNAL + "/tenants", "internal secret prefix (known residual)"],
  [INTERNAL + "x/tenants", "near-miss of secret prefix"],
  ["/internal/opsx/tenants", "near-miss"],
  ["/internal/ops-x/tenants", "near-miss"],
  ["/internal/op/tenants", "near-miss"],
  ["/internal/xps/tenants", "control missing"],
  ["/internal/zzz/tenants", "control missing"],
  ["/admin/nothing", "control missing"],
  ["/nothing", "control missing"],
  ["/_next/data/" + BUILD_ID + "/internal/ops/tenants.json", "GATED nextdata form"],
  ["/_next/data/" + BUILD_ID + "/internal/xps/tenants.json", "control nextdata form"],
];

const N = 400;
const samples = new Map(PATHS.map((p) => [p[0], []]));
for (let i = 0; i < N; i++) for (const [p] of PATHS) samples.get(p).push(await timeit(p));
const rows = PATHS.map(([p, label]) => ({ p, label, p50: med(samples.get(p).slice(20)) }));
rows.sort((a, b) => a.p50 - b.p50);
console.log("port " + PORT + ", N=" + N + " interleaved samples/path, sorted by p50 (ms)");
for (const r of rows.reverse()) console.log("p50=" + r.p50.toFixed(3) + "   " + r.p.padEnd(70) + r.label);
