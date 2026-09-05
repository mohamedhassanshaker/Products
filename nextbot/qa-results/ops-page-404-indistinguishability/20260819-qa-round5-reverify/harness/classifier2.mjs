// QA round-5: attacker-style classifier, extended. With n samples per candidate, does
// median(candidate) > median(known-missing control)? 50% == chance == no oracle.
// Extended beyond round 1: n up to 200, randomized within-pair request order, and a
// candidate set that also probes the NEW question -- now that everything runs middleware
// unconditionally, is there any residual correlation between path SHAPE and cost?
import { timeit, med, shuffle } from "./lib.mjs";

const PORT = Number(process.argv[2] || 3491);
const TRIALS = Number(process.argv[3] || 40);
const NS = (process.argv[4] || "5,20,50,100,200").split(",").map(Number);

const CONTROL = "/internal/zzz/tenants";
const CANDIDATES = [
  ["/internal/ops/tenants", "GATED page (the security boundary)"],
  ["/internal/ops", "GATED root"],
  ["/internal/ops/login", "GATED login"],
  ["/internal/ops/tenants/new", "GATED deep"],
  ["/internal/ops/nope-not-a-page", "GATED-prefix nonexistent leaf"],
  ["/internal/qqq/tenants", "control missing A (same shape)"],
  ["/internal/rrr/tenants", "control missing B (same shape)"],
  ["/admin/nothing", "control missing C (other shape)"],
  ["/internal/opsx/tenants", "NEAR-MISS: ops-shaped but not ops"],
  ["/internal/ops-x/tenants", "NEAR-MISS: ops-shaped but not ops"],
  ["/nothing", "control: nothing like ops at all (depth 1)"],
  ["/a/b/c/d/e", "control: nothing like ops at all (depth 5)"],
  ["/api/internal/ops/tenants", "API gated (middleware now runs on /api)"],
  ["/api/nothing-at-all", "API control missing"],
];

for (const n of NS) {
  console.log("\n--- n=" + n + " samples/path, " + TRIALS + " trials, port " + PORT + " (denied caller) ---");
  for (const [path, label] of CANDIDATES) {
    let hits = 0;
    for (let k = 0; k < TRIALS; k++) {
      const a = [], b = [];
      for (let i = 0; i < n; i++) {
        // randomize which of the pair is requested first, per sample, so neither position
        // systematically follows the other (round-1's fixed a-then-b order is the artifact
        // dev flagged).
        for (const which of shuffle([0, 1])) {
          if (which === 0) a.push(await timeit(PORT, path));
          else b.push(await timeit(PORT, CONTROL));
        }
      }
      if (med(a) > med(b)) hits++;
    }
    const pct = ((hits / TRIALS) * 100).toFixed(0);
    console.log("  " + path.padEnd(28) + " slower-than-control in " + String(hits).padStart(3) + "/" + TRIALS + " (" + pct.padStart(3) + "%)  " + label);
  }
}
