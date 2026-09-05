// QA round-5: is the residual delta that the FIXED-order script still reports (0.45-0.66 ms,
// Mann-Whitney p=0) a property of the ops path, or a property of the POSITION that path occupies
// in the fixed round-robin order?
//
// Decisive test: run the same pair in both orders. If the delta tracks the ops path it keeps the
// same sign; if it tracks position-in-round it FLIPS sign when the two are swapped.
import { timeit, stats, mannWhitney, shuffle } from "./lib.mjs";

const N = Number(process.argv[2] || 400);
const DROP = 20;
const OPS = "/internal/ops/tenants";
const MISS = "/internal/xps/tenants";

async function pairRun(label, cases, doShuffle) {
  const s = new Map(cases.map((c) => [c[0], []]));
  for (let i = 0; i < N; i++) {
    const order = doShuffle ? shuffle([...cases]) : cases;
    for (const [name, port, path, h] of order) s.get(name).push(await timeit(port, path, h));
  }
  const out = {};
  for (const [n, xs] of s) out[n] = { st: stats(xs.slice(DROP)), xs: xs.slice(DROP) };
  console.log("\n### " + label);
  for (const n of Object.keys(out)) console.log("   " + n.padEnd(30) + JSON.stringify(out[n].st));
  return out;
}

// --- Experiment 1: single port, ops FIRST in the round
const e1 = await pairRun("E1 port 3491, fixed order: [OPS, MISS, MISS2]", [
  ["OPS", 3491, OPS, {}],
  ["MISS", 3491, MISS, {}],
  ["MISS2", 3491, "/internal/zzz/tenants", {}],
], false);
let mw = mannWhitney(e1.OPS.xs, e1.MISS.xs);
console.log("   -> OPS(pos0) - MISS(pos1) p50 delta " + (e1.OPS.st.p50 - e1.MISS.st.p50).toFixed(3) + " ms  z=" + mw.z + " p=" + mw.p);

// --- Experiment 2: SAME paths, positions swapped -- MISS now occupies position 0
const e2 = await pairRun("E2 port 3491, fixed order: [MISS, OPS, MISS2]  (positions swapped)", [
  ["MISS", 3491, MISS, {}],
  ["OPS", 3491, OPS, {}],
  ["MISS2", 3491, "/internal/zzz/tenants", {}],
], false);
mw = mannWhitney(e2.OPS.xs, e2.MISS.xs);
console.log("   -> OPS(pos1) - MISS(pos0) p50 delta " + (e2.OPS.st.p50 - e2.MISS.st.p50).toFixed(3) + " ms  z=" + mw.z + " p=" + mw.p);

// --- Experiment 3: control -- two GENUINELY-MISSING paths in fixed order. Any delta here is
// pure position artifact, since neither path is the security boundary.
const e3 = await pairRun("E3 port 3491, fixed order: [MISS_A, MISS_B, MISS2]  (no ops path at all)", [
  ["MISS_A", 3491, "/internal/aaa/tenants", {}],
  ["MISS_B", 3491, "/internal/bbb/tenants", {}],
  ["MISS2", 3491, "/internal/zzz/tenants", {}],
], false);
mw = mannWhitney(e3.MISS_A.xs, e3.MISS_B.xs);
console.log("   -> MISS_A(pos0) - MISS_B(pos1) p50 delta " + (e3.MISS_A.st.p50 - e3.MISS_B.st.p50).toFixed(3) + " ms  z=" + mw.z + " p=" + mw.p);
console.log("      (this pair contains NO ops path: any significant delta here is the harness's own position artifact)");

// --- Experiment 4: the same three-port layout the round-1 script used, but with the ops and
// missing cases swapped inside each deployment.
const e4 = await pairRun("E4 three ports, fixed order, ops/missing SWAPPED within each deployment", [
  ["MISS-3491", 3491, MISS, {}],
  ["OPS-3491", 3491, OPS, {}],
  ["MISS-3492", 3492, MISS, { "x-forwarded-for": "198.51.100.7" }],
  ["OPS-3492", 3492, OPS, { "x-forwarded-for": "198.51.100.7" }],
  ["MISS-3493", 3493, MISS, { "x-forwarded-for": "203.0.113.5" }],
  ["OPS-3493", 3493, OPS, { "x-forwarded-for": "203.0.113.5" }],
], false);
for (const p of ["3491", "3492", "3493"]) {
  const a = e4["OPS-" + p], b = e4["MISS-" + p];
  const m = mannWhitney(a.xs, b.xs);
  console.log("   -> " + p + ": OPS - MISS p50 delta " + (a.st.p50 - b.st.p50).toFixed(3) + " ms  z=" + m.z + " p=" + m.p);
}

// --- Experiment 5: shuffled, same layout, for reference
const e5 = await pairRun("E5 three ports, SHUFFLED per round", [
  ["OPS-3491", 3491, OPS, {}],
  ["MISS-3491", 3491, MISS, {}],
  ["OPS-3492", 3492, OPS, { "x-forwarded-for": "198.51.100.7" }],
  ["MISS-3492", 3492, MISS, { "x-forwarded-for": "198.51.100.7" }],
  ["OPS-3493", 3493, OPS, { "x-forwarded-for": "203.0.113.5" }],
  ["MISS-3493", 3493, MISS, { "x-forwarded-for": "203.0.113.5" }],
], true);
for (const p of ["3491", "3492", "3493"]) {
  const a = e5["OPS-" + p], b = e5["MISS-" + p];
  const m = mannWhitney(a.xs, b.xs);
  console.log("   -> " + p + ": OPS - MISS p50 delta " + (a.st.p50 - b.st.p50).toFixed(3) + " ms  z=" + m.z + " p=" + m.p);
}
