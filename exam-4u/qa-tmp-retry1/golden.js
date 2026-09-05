const { chromium } = require('playwright');
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) console.log('API ERR', r.status(), r.url()); });

  await page.goto('http://qar1-r1msnljw6d.localhost:4210/login');
  await page.fill('input[type="email"], input[name="email"], input#email', 'member+r1msnljw6d@example.test');
  await page.fill('input[type="password"], input[name="password"], input#password', 'Member-Password-1');
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');

  const attemptId = '89e9afc4-0964-44d5-945d-47f236c1532e';
  await page.goto(`http://qar1-r1msnljw6d.localhost:4210/attempts/${attemptId}/take`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/30-timedout-interstitial.png' });

  const viewResults = page.getByRole('button', { name: /view my results/i });
  await viewResults.click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screens/31-results.png' });
  console.log('URL after view results:', page.url());
  console.log('Console errors:', JSON.stringify(consoleErrors));

  // ---- Golden path with a brand new exam type/exam attempt ----
  // Login as admin, create a second exam, start+answer+submit+review as member
  await browser.close();
}
main().catch(e=>{console.error(e); process.exit(1)});
