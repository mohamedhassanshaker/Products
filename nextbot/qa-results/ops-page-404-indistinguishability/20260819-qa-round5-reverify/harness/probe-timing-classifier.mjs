// How practically usable is the latency delta? Attacker-style classifier: with n samples per
// candidate path, does median(candidate) exceed median(known-missing control)?
import http from "node:http";
function t(port, path) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ port, host: "127.0.0.1", method: "GET", path }, (x) => {
      x.on("data", () => {});
      x.on("end", () => res(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    r.on("error", rej);
    r.end();
  });
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const CONTROL = "/internal/zzz/tenants";
const CANDIDATES = [
  ["/internal/ops/tenants", "GATED (should be indistinguishable)"],
  ["/internal/ops", "GATED root"],
  ["/internal/ops/login", "GATED login"],
  ["/internal/qqq/tenants", "control missing A"],
  ["/internal/rrr/tenants", "control missing B"],
  ["/admin/nothing", "control missing C"],
];
for (const n of [5, 20, 50]) {
  const TRIALS = 40;
  console.log("\n--- n=" + n + " samples/path, " + TRIALS + " trials, port 3491 (unconfigured/denied) ---");
  for (const [path, label] of CANDIDATES) {
    let hits = 0;
    for (let k = 0; k < TRIALS; k++) {
      const a = [], b = [];
      for (let i = 0; i < n; i++) { a.push(await t(3491, path)); b.push(await t(3491, CONTROL)); }
      if (med(a) > med(b)) hits++;
    }
    console.log("  " + path.padEnd(26) + " classified as 'slower than control' in " + hits + "/" + TRIALS + " trials   " + label);
  }
}
