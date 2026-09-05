// Diagnosis: after broadening the matcher AND hoisting the gate, /internal/ops/** is still
// ~0.6 ms slower than /internal/xps/**. Is that middleware at all, or is it Next's route
// resolution costing more whenever a *real route folder* exists along the requested path?
// Controls below are all 404s under first segments that DO exist in app/ but have no such child.
import http from "node:http";
const PORT = Number(process.argv[2] ?? 3491);
function t(path) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ port: PORT, host: "127.0.0.1", method: "GET", path }, (x) => { x.on("data", () => {}); x.on("end", () => res(Number(process.hrtime.bigint() - t0) / 1e6)); });
    r.on("error", rej); r.end();
  });
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const PATHS = [
  ["/internal/ops/tenants", "gated (folder internal/ops exists)"],
  ["/internal/ops/zzz", "gated, no such child"],
  ["/internal/zzz/tenants", "no folder at all"],
  ["/login/zzz", "real route folder 'login' exists"],
  ["/dashboard/zzz", "real route (admin group) exists"],
  ["/conversations/zzz/abc", "real route (admin group) exists, depth 3"],
  ["/forgot-password/zzz", "real route folder exists"],
  ["/internal/zzz", "no folder, depth 2"],
  ["/zzz", "no folder, depth 1"],
  ["/api/v1/zzz", "api real folder"],
];
const N = 400;
const s = new Map(PATHS.map((p) => [p[0], []]));
for (let i = 0; i < N; i++) for (const [p] of PATHS) s.get(p).push(await t(p));
const rows = PATHS.map(([p, l]) => ({ p, l, p50: med(s.get(p).slice(20)) })).sort((a, b) => b.p50 - a.p50);
console.log("port " + PORT + " N=" + N + " interleaved, sorted by p50");
for (const r of rows) console.log("p50=" + r.p50.toFixed(3) + "  " + r.p.padEnd(30) + r.l);
