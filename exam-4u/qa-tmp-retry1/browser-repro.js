const { chromium } = require('playwright');
const mysql = require('mysql2/promise');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto('http://qar1-r1msnljw6d.localhost:4210/login');
  await page.screenshot({ path: 'screens/01-login.png' });

  await page.fill('input[type="email"], input[name="email"], input#email', 'member+r1msnljw6d@example.test');
  await page.fill('input[type="password"], input[name="password"], input#password', 'Member-Password-1');
  await page.screenshot({ path: 'screens/02-login-filled.png' });
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/03-after-login.png' });
  console.log('URL after login:', page.url());

  // Navigate to exams available
  await page.goto('http://qar1-r1msnljw6d.localhost:4210/exams/available');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/04-available-exams.png' });

  // Click the exam
  const examLink = page.locator('text=QA Retry1 Exam').first();
  await examLink.click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/05-instructions.png' });
  console.log('URL at instructions:', page.url());

  // Start button
  const startBtn = page.locator('button', { hasText: /start/i }).first();
  await startBtn.click();
  await page.waitForURL(/\/attempts\/.+\/take/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/06-taking-q0.png' });
  console.log('URL taking:', page.url());

  const url = page.url();
  const match = url.match(/attempts\/([a-f0-9-]+)\/take/);
  const attemptId = match ? match[1] : null;
  console.log('attemptId from URL:', attemptId);

  if (!attemptId) throw new Error('Could not extract attemptId from URL: ' + url);

  // Backdate deadline_at mid-session (simulate deadline passing while mid-navigation)
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'YourPassword', database:'t_qar1_r1msnljw6d_f14760a9' });
  await conn.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?', [attemptId]);
  console.log('Backdated deadline_at for attempt', attemptId);
  const [rowsBefore] = await conn.query('SELECT status FROM attempt WHERE id=?', [attemptId]);
  console.log('DB status right after backdate (before any request):', rowsBefore[0].status);

  // Now click Next (mid-navigation action) without reloading the page
  const nextBtn = page.locator('button', { hasText: /^next$/i }).first();
  await nextBtn.click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/07-after-next-post-backdate.png' });

  const [rowsAfter] = await conn.query('SELECT status FROM attempt WHERE id=?', [attemptId]);
  console.log('DB status after clicking Next post-backdate:', rowsAfter[0].status);

  const bodyText = await page.textContent('body');
  console.log('Contains "Time\'s up"?', bodyText.includes("Time's up"));
  console.log('Contains "automatically submitted"?', bodyText.includes('automatically submitted'));

  // Check for a path to view results (a button/link)
  const resultLink = await page.locator('a, button', { hasText: /result|review/i }).count();
  console.log('Result/review link count on interstitial:', resultLink);

  console.log('Console errors during flow:', JSON.stringify(consoleErrors));

  await conn.end();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
