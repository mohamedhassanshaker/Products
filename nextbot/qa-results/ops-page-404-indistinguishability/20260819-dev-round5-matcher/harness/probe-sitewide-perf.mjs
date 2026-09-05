// Round 5, Defect 1 fix: what does broadening `config.matcher` to (nearly) every path cost
// the REST of the app? Measures a representative non-ops request of each class, interleaved,
// on the configured deployment (3492) so the numbers are comparable before/after the change.
//
// Classes measured:
//   - real page (prerendered/dynamic app route)          -> now goes through middleware
//   - api route (unmatched + real)                       -> now goes through middleware
//   - genuinely-missing page path                        -> now goes through middleware
//   - _next/static chunk                                 -> deliberately EXCLUDED from the matcher
//   - gated ops path                                     -> went through middleware before and after
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

function timeit(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.request({ port, host: "127.0.0.1", method: "GET", path: p, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode }));
    });
    req.on("error", reject);
    req.end();
  });
}
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (pp) => s[Math.min(s.length - 1, Math.floor(pp * s.length))];
  return {
    n: s.length,
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    p50: +q(0.5).toFixed(3),
    p90: +q(0.9).toFixed(3),
    p99: +q(0.99).toFixed(3),
  };
}

// Pick a real built static chunk so the static-asset case is a 200, not a 404.
const chunkDir = path.join(process.cwd(), ".next", "static", "chunks");
let chunk = "/_next/static/chunks/does-not-exist.js";
try {
  const f = fs.readdirSync(chunkDir).find((x) => x.endsWith(".js"));
  if (f) chunk = "/_next/static/chunks/" + f;
} catch {
  /* leave the 404 fallback; the class is still measured, just not as a 200 */
}

const PORT = Number(process.argv[2] ?? 3492);
const CASES = [
  ["page /login (real route)", "/login", {}],
  ["page / (real route)", "/", {}],
  ["missing page path", "/internal/xps/tenants", {}],
  ["missing page path 2", "/nothing-here-at-all", {}],
  ["api unmatched", "/api/definitely-not-a-route", {}],
  ["api ops (guarded)", "/api/internal/ops/tenants", {}],
  ["static chunk (matcher-excluded)", chunk, {}],
  ["gated ops page", "/internal/ops/tenants", {}],
];
const N = 200;
const samples = new Map(CASES.map((c) => [c[0], []]));
const statuses = new Map();
for (let i = 0; i < N; i++) {
  for (const [name, p, h] of CASES) {
    const r = await timeit(PORT, p, h);
    samples.get(name).push(r.ms);
    statuses.set(name, r.status);
  }
}
console.log("port " + PORT + ", N=" + N + " interleaved samples/case (first 20 dropped as warmup)");
for (const [name, xs] of samples) {
  console.log(name.padEnd(34) + " status=" + statuses.get(name) + " " + JSON.stringify(stats(xs.slice(20))));
}
