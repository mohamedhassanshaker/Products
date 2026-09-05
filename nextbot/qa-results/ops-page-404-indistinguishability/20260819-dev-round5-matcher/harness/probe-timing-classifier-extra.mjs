// Same classifier as QA's (median-of-n vs a known-missing control, 40 trials), but with the
// candidate list extended to every class the round-5 fix could have introduced a *narrower*
// signal in: percent-escaped spellings (which now take the decode + internal-neutralization
// branch), the internal secret prefix and its near-miss, the API surface, and a real route.
// A row near 20/40 is noise; a row at 40/40 (or 0/40) is a signal.
import http from "node:http";
const PORT = Number(process.argv[2] ?? 3491);
const SECRET = "nb-c-4f21c8a7e3d9b605";

function t(path) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    const r = http.request({ port: PORT, host: "127.0.0.1", method: "GET", path }, (x) => {
      x.on("data", () => {});
      x.on("end", () => res(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    r.on("error", rej);
    r.end();
  });
}
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const CONTROL = "/internal/zzz/tenants";
const CANDIDATES = [
  ["/internal/ops/tenants", "GATED"],
  ["/internal/ops", "GATED root"],
  ["/internal/ops/login", "GATED login"],
  ["/internal/ops/" + SECRET + "/tenants", "internal secret prefix"],
  ["/internal/ops/nb%2Dc%2D4f21c8a7e3d9b605/tenants", "escaped secret prefix (Defect 2 path)"],
  ["/internal/zzz/nb%2Dc%2D4f21c8a7e3d9b605/tenants", "escaped, non-ops control"],
  ["/internal/ops/" + SECRET + "x/tenants", "near-miss of secret prefix"],
  ["/internal/opsx/tenants", "near-miss of public prefix"],
  ["/api/internal/ops/tenants", "API gated"],
  ["/api/definitely-not-a-route", "API control"],
  ["/login", "real route (200)"],
  ["/internal/qqq/tenants", "control missing A"],
  ["/internal/rrr/tenants", "control missing B"],
  ["/admin/nothing", "control missing C"],
];
for (const n of [5, 20, 50]) {
  const TRIALS = 40;
  console.log("\n--- n=" + n + " samples/path, " + TRIALS + " trials, port " + PORT + " ---");
  for (const [path, label] of CANDIDATES) {
    let hits = 0;
    for (let k = 0; k < TRIALS; k++) {
      const a = [];
      const b = [];
      for (let i = 0; i < n; i++) {
        a.push(await t(path));
        b.push(await t(CONTROL));
      }
      if (med(a) > med(b)) hits++;
    }
    console.log("  " + path.padEnd(50) + " slower than control in " + String(hits).padStart(2) + "/" + TRIALS + "   " + label);
  }
}
