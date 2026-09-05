// QA round-5: what did broadening the matcher to ~every request cost the rest of the app?
// Dev claims ~+0.7 ms per non-asset request app-wide, static assets unaffected.
import { timeit, stats, shuffle } from "./lib.mjs";
const PORT = Number(process.argv[2] || 3492);
const N = Number(process.argv[3] || 200);
const XFF = { "x-forwarded-for": "203.0.113.5" };
const CASES = [
  ["real page /login", "/login", {}],
  ["real page / (root)", "/", {}],
  ["missing page", "/nothing-here-at-all", {}],
  ["missing page deep", "/a/b/c/d/e/f", {}],
  ["api unmatched", "/api/nope/nope", {}],
  ["api ops (guarded)", "/api/internal/ops/tenants", {}],
  ["api v1 unmatched", "/api/v1/nope", {}],
  ["gated ops page (denied)", "/internal/ops/tenants", {}],
  ["gated ops page (allowed)", "/internal/ops/login", XFF],
  ["static chunk (matcher-excluded)", process.argv[4] || "/_next/static/chunks/webpack.js", {}],
  ["favicon (matcher-excluded)", "/favicon.ico", {}],
  ["_next/image (matcher-excluded)", "/_next/image", {}],
];
const samples = new Map(CASES.map((c) => [c[0], []]));
for (let i = 0; i < N; i++) for (const [name, path, h] of shuffle([...CASES])) samples.get(name).push(await timeit(PORT, path, h));
console.log("port " + PORT + ", N=" + N + " interleaved (shuffled order) samples/case, first 20 dropped");
for (const [name, xs] of samples) console.log("  " + name.padEnd(34) + JSON.stringify(stats(xs.slice(20))));
