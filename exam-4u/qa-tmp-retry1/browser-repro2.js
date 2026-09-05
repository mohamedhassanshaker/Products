const { chromium } = require('playwright');
const mysql = require('mysql2/promise');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/attempts') && r.status() >= 400) console.log('API', r.status(), r.url()); });

  await page.goto('http://qar1-r1msnljw6d.localhost:4210/login');
  await page.fill('input[type="email"], input[name="email"], input#email', 'member+r1msnljw6d@example.test');
  await page.fill('input[type="password"], input[name="password"], input#password', 'Member-Password-1');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  const attemptId = '3845a3f1-48b5-48c6-b55d-a8e6c56a2b24';
  await page.goto(`http://qar1-r1msnljw6d.localhost:4210/attempts/${attemptId}/take`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/10-taking-q0-resumed.png' });
  console.log('URL:', page.url());

  // Backdate deadline_at mid-session (simulate deadline passing while mid-navigation)
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'YourPassword', database:'t_qar1_r1msnljw6d_f14760a9' });
  await conn.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?', [attemptId]);
  console.log('Backdated deadline_at for attempt', attemptId);
  const [rowsBefore] = await conn.query('SELECT status FROM attempt WHERE id=?', [attemptId]);
  console.log('DB status right after backdate (before any request):', rowsBefore[0].status);

  const nextBtn = page.getByRole('button', { name: 'Next', exact: true });
  await nextBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screens/11-after-next-post-backdate.png' });

  const [rowsAfter] = await conn.query('SELECT status FROM attempt WHERE id=?', [attemptId]);
  console.log('DB status after clicking Next post-backdate:', rowsAfter[0].status);

  const bodyText = await page.textContent('body');
  console.log('Contains "Time\'s up"?', bodyText.includes("Time's up"));
  console.log('Contains "automatically submitted"?', bodyText.includes('automatically submitted'));
  const resultLink = await page.locator('a, button', { hasText: /result|review/i }).count();
  console.log('Result/review link count on interstitial:', resultLink);
  console.log('Console errors during flow:', JSON.stringify(consoleErrors));

  await conn.end();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
