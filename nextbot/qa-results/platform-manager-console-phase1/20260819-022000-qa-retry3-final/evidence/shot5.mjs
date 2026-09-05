import { chromium } from 'playwright';
const out = process.argv[2];
const exe = 'C:/Users/m.hassan/AppData/Local/ms-playwright/chromium-1148/chrome-win/chrome.exe';
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const cases = [
  ['01-denied-ops-tenants-page', 'http://127.0.0.1:3312/internal/ops/tenants'],
  ['02-genuine-missing-page', 'http://127.0.0.1:3312/internal/ops/zzz-missing'],
  ['03-denied-ops-login-page', 'http://127.0.0.1:3312/internal/ops/login'],
];
for (const [name, url] of cases) {
  const r = await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.screenshot({ path: out + '/' + name + '.png', fullPage: true });
  console.log(name, r.status(), JSON.stringify(await p.title()));
}
console.log('console errors:', JSON.stringify(errs));
await b.close();
