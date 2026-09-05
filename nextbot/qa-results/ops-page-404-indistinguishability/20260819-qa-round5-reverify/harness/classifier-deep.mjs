// QA round-5: deep classifier. n=100 and n=200 on a focused candidate set, each candidate
// compared against a control of its OWN class (page vs page, api vs api), because the broad run
// showed /api/** is inherently slower than a static 404 page -- an axis that exists for every
// /api path, ops or not, so the ops API must be compared to a missing API.
import { timeit, med, shuffle, mannWhitney, stats } from "./lib.mjs";

const PORT = Number(process.argv[2] || 3491);
const TRIALS = Number(process.argv[3] || 40);
const NS = (process.argv[4] || "100,200").split(",").map(Number);

const GROUPS = [
  { control: "/internal/zzz/tenants", label: "page control", cands: [
    ["/internal/ops/tenants", "GATED page (the boundary)"],
    ["/internal/ops/login", "GATED login"],
    ["/internal/opsx/tenants", "NEAR-MISS ops-shaped, not ops"],
    ["/internal/qqq/tenants", "missing control (sanity: must be ~50%)"],
  ]},
  { control: "/api/zzz/tenants", label: "api control", cands: [
    ["/api/internal/ops/tenants", "GATED api"],
    ["/api/qqq/tenants", "missing api control (sanity)"],
  ]},
];

for (const n of NS) {
  console.log("\n--- n=" + n + " samples/path, " + TRIALS + " trials, port " + PORT + " ---");
  for (const g of GROUPS) {
    console.log("  control = " + g.control);
    for (const [path, label] of g.cands) {
      let hits = 0;
      const all = [], allc = [];
      for (let k = 0; k < TRIALS; k++) {
        const a = [], b = [];
        for (let i = 0; i < n; i++) {
          for (const w of shuffle([0, 1])) {
            if (w === 0) a.push(await timeit(PORT, path));
            else b.push(await timeit(PORT, g.control));
          }
        }
        if (med(a) > med(b)) hits++;
        all.push(...a); allc.push(...b);
      }
      const mw = mannWhitney(all, allc);
      console.log("    " + path.padEnd(28) + String(hits).padStart(3) + "/" + TRIALS + " (" + ((hits / TRIALS) * 100).toFixed(0).padStart(3) + "%)  p50 " + stats(all).p50 + " vs " + stats(allc).p50 + "  z=" + mw.z + " p=" + mw.p + "  " + label);
    }
  }
}
