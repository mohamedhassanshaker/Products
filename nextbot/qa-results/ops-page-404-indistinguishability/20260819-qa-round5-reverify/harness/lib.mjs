// Shared helpers for the QA round-5 re-verification timing/response harness.
import http from "node:http";
import crypto from "node:crypto";

export const P_UNCONF = 3491; // ops env entirely unset -> every caller denied
export const P_PROXY = 3492;  // configured + trusted proxy 127.0.0.1 -> XFF honored
export const P_NOPROXY = 3493; // configured, no trusted proxy -> XFF ignored, all denied
export const INTERNAL = "/internal/ops/nb-c-4f21c8a7e3d9b605";
export const GOOD_COOKIE = "nb_ops_session=test-operator-token-abc123";
export const ALLOW_XFF = { "x-forwarded-for": "203.0.113.5" };

const STRICT_VOLATILE = new Set(["date", "connection", "keep-alive"]);

export function timeit(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.request({ port, host: "127.0.0.1", method: "GET", path, headers }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(Number(process.hrtime.bigint() - t0) / 1e6));
    });
    req.on("error", reject);
    req.end();
  });
}

export function raw(port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: "127.0.0.1", method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const rh = res.rawHeaders;
        const ordered = [];
        for (let i = 0; i < rh.length; i += 2) {
          if (!STRICT_VOLATILE.has(rh[i].toLowerCase())) ordered.push(rh[i] + ": " + rh[i + 1]);
        }
        resolve({
          status: res.statusCode,
          headers: ordered,
          hash: crypto.createHash("sha256").update(body).digest("hex").slice(0, 16),
          len: body.length,
          text: body.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export const sig = (r) => r.status + "|" + r.headers.join(" ~ ") + "|" + r.hash;

export function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: +mean.toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), min: +s[0].toFixed(3), max: +s[s.length - 1].toFixed(3) };
}

export const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + y);
}

export function mannWhitney(a, b) {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  let i = 0;
  const ranks = new Array(all.length);
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let r1 = 0;
  for (let k = 0; k < all.length; k++) if (all[k].g === 0) r1 += ranks[k];
  const n1 = a.length, n2 = b.length;
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const sd = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (u1 - mu) / sd;
  return { z: +z.toFixed(3), p: +(2 * (1 - normCdf(Math.abs(z)))).toFixed(5) };
}
