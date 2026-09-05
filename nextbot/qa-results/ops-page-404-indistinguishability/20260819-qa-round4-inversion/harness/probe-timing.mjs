// TEST 2d: timing. Can a caller distinguish "gated path, checks ran, denied" from
// "path genuinely does not exist" by latency alone? Also measures the allow path for context.
import http from "node:http";

function timeit(port, path, headers) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.request({ port, host: "127.0.0.1", method: "GET", path, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    req.on("error", reject);
    req.end();
  });
}
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), min: +s[0].toFixed(3), max: +s[s.length - 1].toFixed(3) };
}

const N = 400;
const CASES = [
  ["denied-gated  (3491 unconfigured)", 3491, "/internal/ops/tenants", {}],
  ["missing-path  (3491 unconfigured)", 3491, "/internal/xps/tenants", {}],
  ["missing-path2 (3491 unconfigured)", 3491, "/nothing-here-at-all", {}],
  ["denied-gated  (3492 bad IP, checks run)", 3492, "/internal/ops/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["missing-path  (3492 bad IP)", 3492, "/internal/xps/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["denied-gated  (3493 spoof XFF, checks run)", 3493, "/internal/ops/tenants", { "x-forwarded-for": "203.0.113.5" }],
  ["missing-path  (3493 spoof XFF)", 3493, "/internal/xps/tenants", { "x-forwarded-for": "203.0.113.5" }],
  ["ALLOWED rewrite->console (3492)", 3492, "/internal/ops/login", { "x-forwarded-for": "203.0.113.5" }],
];

// interleave to cancel drift
const samples = new Map(CASES.map((c) => [c[0], []]));
for (let i = 0; i < N; i++) {
  for (const [name, port, path, headers] of CASES) {
    samples.get(name).push(await timeit(port, path, headers));
  }
}
for (const [name, xs] of samples) {
  const st = stats(xs.slice(20)); // drop warmup
  console.log(name.padEnd(44) + JSON.stringify(st));
}
const d = stats(samples.get("denied-gated  (3491 unconfigured)").slice(20));
const m = stats(samples.get("missing-path  (3491 unconfigured)").slice(20));
console.log("\nunconfigured: gated-vs-missing mean delta = " + (d.mean - m.mean).toFixed(3) + " ms, p50 delta = " + (d.p50 - m.p50).toFixed(3) + " ms");
const d2 = stats(samples.get("denied-gated  (3492 bad IP, checks run)").slice(20));
const m2 = stats(samples.get("missing-path  (3492 bad IP)").slice(20));
console.log("configured/denied: gated-vs-missing mean delta = " + (d2.mean - m2.mean).toFixed(3) + " ms, p50 delta = " + (d2.p50 - m2.p50).toFixed(3) + " ms");
