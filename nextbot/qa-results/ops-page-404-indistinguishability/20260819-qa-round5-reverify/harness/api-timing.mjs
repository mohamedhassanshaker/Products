// QA round-5, follow-up on an unexpected classifier result: /api/internal/ops/** measured
// CONSISTENTLY FASTER (~0.12 ms, 0/40 classifier, z=-23) than a genuinely-unmatched /api path.
// Investigate properly: multiple controls both ways, per-deployment, and across caller/gate
// states -- to establish (a) is it real and robust, (b) is it gate-DEPENDENT (an authorization
// oracle) or only existence-revealing, (c) is it specific to the ops prefix or a general
// "real route vs catch-all" property of this app's /api surface.
import { timeit, stats, mannWhitney, shuffle, ALLOW_XFF, GOOD_COOKIE } from "./lib.mjs";

const N = Number(process.argv[2] || 400);
const DROP = 20;

async function run(label, cases) {
  const s = new Map(cases.map((c) => [c[0], []]));
  for (let i = 0; i < N; i++) for (const [n, port, path, h] of shuffle([...cases])) s.get(n).push(await timeit(port, path, h));
  console.log("\n### " + label + " (N=" + N + ", shuffled order, first " + DROP + " dropped)");
  const out = {};
  for (const [n, xs] of s) { out[n] = xs.slice(DROP); console.log("   " + n.padEnd(40) + JSON.stringify(stats(xs.slice(DROP)))); }
  return out;
}

// (a)+(c): ops api vs several unmatched-api controls vs another REAL api route, denied caller
const a = await run("A. denied caller (3491): ops api vs unmatched api vs other real api routes", [
  ["ops-api /api/internal/ops/tenants", 3491, "/api/internal/ops/tenants", {}],
  ["ops-api /api/internal/ops/session", 3491, "/api/internal/ops/session", {}],
  ["unmatched /api/zzz/tenants", 3491, "/api/zzz/tenants", {}],
  ["unmatched /api/internal/xps/tenants", 3491, "/api/internal/xps/tenants", {}],
  ["unmatched /api/qqq/qqq", 3491, "/api/qqq/qqq", {}],
  ["real-route /api/v1/health", 3491, "/api/v1/health", {}],
  ["unmatched /api/v1/zzzzzz", 3491, "/api/v1/zzzzzz", {}],
]);
const ctrl = a["unmatched /api/internal/xps/tenants"];
for (const k of Object.keys(a)) {
  if (k === "unmatched /api/internal/xps/tenants") continue;
  const m = mannWhitney(a[k], ctrl);
  console.log("   -> " + k.padEnd(40) + " vs xps control: p50 delta " + (stats(a[k]).p50 - stats(ctrl).p50).toFixed(3) + " ms  z=" + m.z + " p=" + m.p);
}

// (b): gate dependence -- same ops api path, denied vs fully-authorized, each against its own
// deployment's unmatched control (so deployment-level differences cancel).
const b = await run("B. gate dependence: ops api under denied vs allowed callers", [
  ["3491 denied   ops-api", 3491, "/api/internal/ops/tenants", {}],
  ["3491 denied   unmatched", 3491, "/api/internal/xps/tenants", {}],
  ["3492 allowed  ops-api", 3492, "/api/internal/ops/tenants", Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE })],
  ["3492 allowed  unmatched", 3492, "/api/internal/xps/tenants", Object.assign({}, ALLOW_XFF, { cookie: GOOD_COOKIE })],
  ["3492 denied   ops-api", 3492, "/api/internal/ops/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["3492 denied   unmatched", 3492, "/api/internal/xps/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["3493 denied   ops-api", 3493, "/api/internal/ops/tenants", ALLOW_XFF],
  ["3493 denied   unmatched", 3493, "/api/internal/xps/tenants", ALLOW_XFF],
]);
for (const p of ["3491 denied  ", "3492 allowed ", "3492 denied  ", "3493 denied  "]) {
  const o = b[p + " ops-api"], u = b[p + " unmatched"];
  if (!o || !u) { console.log("   (missing key for " + p + ")"); continue; }
  const m = mannWhitney(o, u);
  console.log("   -> " + p + ": ops-api - unmatched p50 delta " + (stats(o).p50 - stats(u).p50).toFixed(3) + " ms  z=" + m.z + " p=" + m.p);
}
