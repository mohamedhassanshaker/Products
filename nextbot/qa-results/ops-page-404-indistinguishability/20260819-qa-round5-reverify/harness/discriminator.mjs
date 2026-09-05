// QA round-5: ranking probe. Many same-length-ish paths, heavily interleaved with a
// per-round shuffled order, sorted by p50. In round 1 this split cleanly at the matcher
// boundary (ops family ~1.77-1.93 ms, everything else ~1.24-1.29 ms). If the fix holds,
// the ops family must sit inside the noise band mid-pack, and there must ALSO be no new
// split between "ops-shaped but not ops" and "nothing like ops".
import { timeit, stats, shuffle } from "./lib.mjs";

const PORT = Number(process.argv[2] || 3491);
const N = Number(process.argv[3] || 400);
const PATHS = [
  ["GATED    ", "/internal/ops/tenants"],
  ["GATED    ", "/internal/ops/login"],
  ["GATED    ", "/internal/ops"],
  ["GATED    ", "/internal/ops/tenants/new"],
  ["GATED    ", "/internal/ops/zzzzzz"],
  ["SECRETPFX", "/internal/ops/nb-c-4f21c8a7e3d9b605/tenants"],
  ["NEARMISS ", "/internal/opsx/tenants"],
  ["NEARMISS ", "/internal/ops-x/tenants"],
  ["NEARMISS ", "/internal/opsy/tenants"],
  ["MISSING  ", "/internal/xps/tenants"],
  ["MISSING  ", "/internal/zzz/tenants"],
  ["MISSING  ", "/internal/qqq/tenants"],
  ["MISSING  ", "/nothing-here-at-all"],
  ["MISSING  ", "/admin/nothing/at/all"],
  ["MISSING  ", "/aaaaaaaaaaaa/bbbbbb"],
  ["APIGATED ", "/api/internal/ops/tenants"],
  ["APIMISS  ", "/api/xxxxxxxx/tenants"],
];

const samples = new Map(PATHS.map((p) => [p[1], []]));
for (let i = 0; i < N; i++) {
  for (const [, path] of shuffle([...PATHS])) samples.get(path).push(await timeit(PORT, path));
}
console.log("port " + PORT + ", N=" + N + " interleaved samples/path, per-round SHUFFLED order, sorted by p50 (ms)");
const rows = PATHS.map(([cls, path]) => ({ cls, path, s: stats(samples.get(path).slice(20)) }));
rows.sort((x, y) => x.s.p50 - y.s.p50);
for (const r of rows) console.log("  " + r.cls + " " + r.path.padEnd(46) + JSON.stringify(r.s));
const ps = rows.map((r) => r.s.p50);
console.log("\np50 spread across all " + rows.length + " paths: " + (Math.max(...ps) - Math.min(...ps)).toFixed(3) + " ms");
const grp = (c) => rows.filter((r) => r.cls.trim() === c).map((r) => r.s.p50);
for (const c of ["GATED", "NEARMISS", "MISSING", "SECRETPFX", "APIGATED", "APIMISS"]) {
  const g = grp(c);
  if (!g.length) continue;
  console.log("  " + c.padEnd(10) + " p50 range " + Math.min(...g).toFixed(3) + " - " + Math.max(...g).toFixed(3));
}
const gatedRanks = rows.map((r, i) => [r.cls.trim(), i]).filter(([c]) => c === "GATED").map(([, i]) => i);
console.log("  GATED paths' rank positions (0=fastest of " + rows.length + "): " + gatedRanks.join(", "));
