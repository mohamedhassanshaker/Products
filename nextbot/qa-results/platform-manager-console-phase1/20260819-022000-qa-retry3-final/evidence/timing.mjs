import http from 'node:http';
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function req(port, path, headers) {
  return new Promise((res, rej) => {
    const t = process.hrtime.bigint();
    const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent, headers }, (rs) => {
      rs.on('data', () => {}); rs.on('end', () => res({ ms: Number(process.hrtime.bigint() - t) / 1e6, code: rs.statusCode }));
    });
    r.on('error', rej); r.end();
  });
}
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.floor(p * (s.length - 1))];
  return { n: s.length, min: +s[0].toFixed(3), p10: +q(0.1).toFixed(3), p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(3) }; };
const port = Number(process.argv[2]);
const arms = JSON.parse(process.argv[3]);
const N = Number(process.argv[4] || 300);
const out = {}; for (const k of Object.keys(arms)) out[k] = [];
// warmup
for (let i = 0; i < 40; i++) for (const [k, a] of Object.entries(arms)) await req(port, a.path.replace('%i', i), a.headers || {});
for (let i = 0; i < N; i++) {
  const keys = Object.keys(arms);
  for (const k of keys) { const a = arms[k]; const r = await req(port, a.path.replace('%i', i), a.headers || {}); out[k].push(r.ms); out[k + '_code'] = r.code; }
}
for (const k of Object.keys(arms)) console.log(k.padEnd(22), 'code=' + out[k + '_code'], JSON.stringify(stats(out[k])));
