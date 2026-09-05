// QA round-5 re-verification of Defect 1's timing oracle.
//
// This is round-1's probe-timing.mjs re-run in FOUR modes, because dev claimed the original
// script's fixed case order is itself an artifact (its `denied-gated` case is always the first
// request of each round, immediately after the ~8 ms ALLOWED console render):
//   A  fixed order, allowed-render case included   (== round-1 script exactly)
//   B  shuffled order per round, allowed included
//   C  fixed order, allowed-render case REMOVED    (removes the slow-neighbour confound)
//   D  shuffled order per round, allowed removed   (the cleanest oracle test)
import { timeit, stats, mannWhitney, shuffle } from "./lib.mjs";

const N = Number(process.argv[2] || 400);
const WARMUP_DROP = 20;

const ALLOWED_CASE = ["ALLOWED rewrite->console (3492)", 3492, "/internal/ops/login", { "x-forwarded-for": "203.0.113.5" }];
const CORE = [
  ["denied-gated  (3491 unconfigured)", 3491, "/internal/ops/tenants", {}],
  ["missing-path  (3491 unconfigured)", 3491, "/internal/xps/tenants", {}],
  ["missing-path2 (3491 unconfigured)", 3491, "/nothing-here-at-all", {}],
  ["denied-gated  (3492 bad IP, checks run)", 3492, "/internal/ops/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["missing-path  (3492 bad IP)", 3492, "/internal/xps/tenants", { "x-forwarded-for": "198.51.100.7" }],
  ["denied-gated  (3493 spoof XFF, checks run)", 3493, "/internal/ops/tenants", { "x-forwarded-for": "203.0.113.5" }],
  ["missing-path  (3493 spoof XFF)", 3493, "/internal/xps/tenants", { "x-forwarded-for": "203.0.113.5" }],
];

async function run(label, cases, doShuffle) {
  const samples = new Map(cases.map((c) => [c[0], []]));
  for (let i = 0; i < N; i++) {
    const order = doShuffle ? shuffle([...cases]) : cases;
    for (const [name, port, path, headers] of order) {
      samples.get(name).push(await timeit(port, path, headers));
    }
  }
  console.log("\n########## " + label + "  (N=" + N + "/case, first " + WARMUP_DROP + " dropped) ##########");
  const st = new Map();
  for (const [name, xs] of samples) {
    const s = stats(xs.slice(WARMUP_DROP));
    st.set(name, { s, xs: xs.slice(WARMUP_DROP) });
    console.log("  " + name.padEnd(44) + JSON.stringify(s));
  }
  const pairs = [
    ["denied-gated  (3491 unconfigured)", "missing-path  (3491 unconfigured)", "unconfigured (same shape/depth)"],
    ["denied-gated  (3491 unconfigured)", "missing-path2 (3491 unconfigured)", "unconfigured (shallow control)"],
    ["denied-gated  (3492 bad IP, checks run)", "missing-path  (3492 bad IP)", "configured, disallowed IP"],
    ["denied-gated  (3493 spoof XFF, checks run)", "missing-path  (3493 spoof XFF)", "configured, no trusted proxy"],
  ];
  for (const [a, b, why] of pairs) {
    if (!st.has(a) || !st.has(b)) continue;
    const A = st.get(a), B = st.get(b);
    const mw = mannWhitney(A.xs, B.xs);
    console.log(
      "  -> " + why.padEnd(32) +
      " p50 delta " + (A.s.p50 - B.s.p50).toFixed(3) + " ms" +
      " | mean delta " + (A.s.mean - B.s.mean).toFixed(3) + " ms" +
      " | Mann-Whitney z=" + mw.z + " p=" + mw.p
    );
  }
}

await run("MODE A  fixed order, ALLOWED render included  (round-1 script, verbatim)", [...CORE, ALLOWED_CASE], false);
await run("MODE B  SHUFFLED order, ALLOWED render included", [...CORE, ALLOWED_CASE], true);
await run("MODE C  fixed order, ALLOWED render REMOVED", CORE, false);
await run("MODE D  SHUFFLED order, ALLOWED render REMOVED  (cleanest)", CORE, true);
