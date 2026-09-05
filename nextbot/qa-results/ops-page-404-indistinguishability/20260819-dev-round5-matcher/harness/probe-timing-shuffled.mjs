// probe-timing.mjs's remaining ~0.6 ms "gated vs missing" delta is a MEASUREMENT ARTIFACT of
// that script's fixed case order: `denied-gated` is always the first request of each round,
// immediately after the round's heaviest case (the ALLOWED console render, ~8.5 ms), so it
// systematically absorbs client-side GC/JIT cost the later cases don't. Same cases, same
// servers, same sample count — only the order within each round is shuffled.
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
  return { n: s.length, mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3) };
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
const samples = new Map(CASES.map((c) => [c[0], []]));
for (let i = 0; i < N; i++) {
  const order = [...CASES].sort(() => Math.random() - 0.5);
  for (const [name, port, path, headers] of order) samples.get(name).push(await timeit(port, path, headers));
}
for (const [name, xs] of samples) console.log(name.padEnd(44) + JSON.stringify(stats(xs.slice(20))));
const d = (a, b) => (stats(samples.get(a).slice(20)).p50 - stats(samples.get(b).slice(20)).p50).toFixed(3);
console.log("\nunconfigured:      gated-vs-missing p50 delta = " + d("denied-gated  (3491 unconfigured)", "missing-path  (3491 unconfigured)") + " ms");
console.log("configured/denied: gated-vs-missing p50 delta = " + d("denied-gated  (3492 bad IP, checks run)", "missing-path  (3492 bad IP)") + " ms");
console.log("noproxy/denied:    gated-vs-missing p50 delta = " + d("denied-gated  (3493 spoof XFF, checks run)", "missing-path  (3493 spoof XFF)") + " ms");
