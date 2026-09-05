import { chromium } from "file:///C:/Users/m.hassan/AppData/Local/npm-cache/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const SHOTS = "qa-results/final-review-full-app/2026-09-01T0900Z/shots";
const errs = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errs.push(`${page.url()} :: ${m.text()}`); });
page.on("pageerror", (e) => errs.push(`PAGEERR ${page.url()} :: ${e.message}`));
await page.goto(`${BASE}/login`);
await page.fill('input[name="tenantSlug"], input[name="tenant"]', "demo").catch(()=>{});
await page.fill('input[type="email"], input[name="email"]', "admin@demo.nextbot.local");
await page.fill('input[type="password"], input[name="password"]', "NextbotDemo!2026");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 30000 });

await page.goto(`${BASE}/settings`); await page.waitForLoadState("networkidle").catch(()=>{});
const cards = await page.$$eval('a[href^="/settings/"]', (as) => [...new Set(as.map(a=>a.getAttribute("href")))]);
console.log("SETTINGS_CARD_HREFS:", cards.length); cards.forEach(c=>console.log("   ", c));
await page.screenshot({ path: `${SHOTS}/92-settings-hub-full.png`, fullPage: true });

// MCP enrolment wizard
await page.goto(`${BASE}/mcp/servers/new`); await page.waitForLoadState("networkidle").catch(()=>{});
console.log("MCP_WIZARD_H1:", (await page.locator("h1").first().textContent().catch(()=>null)||"").trim());
console.log("MCP_WIZARD_STEP:", (await page.getByText(/Step 1 of/).first().textContent().catch(()=>null)||"").trim());
await page.screenshot({ path: `${SHOTS}/93-mcp-wizard.png`, fullPage: true });

// Agent Design Studio
await page.goto(`${BASE}/agent-platform/definitions`); await page.waitForLoadState("networkidle").catch(()=>{});
const defLink = await page.$$eval('a[href*="/agent-platform/definitions/"]', as => as.map(a=>a.getAttribute("href")).find(h=>h && !h.endsWith("/definitions")));
console.log("DEF_LINK:", defLink);
if (defLink) {
  await page.goto(BASE + defLink); await page.waitForLoadState("networkidle").catch(()=>{});
  console.log("DEF_DETAIL_H1:", (await page.locator("h1").first().textContent().catch(()=>null)||"").trim());
  await page.screenshot({ path: `${SHOTS}/94-agent-definition-detail.png`, fullPage: true });
  const studio = await page.$$eval('a[href*="studio"]', as => as.map(a=>a.getAttribute("href"))[0]);
  if (studio) { await page.goto(BASE+studio); await page.waitForLoadState("networkidle").catch(()=>{});
    console.log("STUDIO_H1:", (await page.locator("h1").first().textContent().catch(()=>null)||"").trim());
    console.log("STUDIO_STEP:", (await page.getByText(/Step 1 of/).first().textContent().catch(()=>null)||"").trim());
    await page.screenshot({ path: `${SHOTS}/95-agent-design-studio.png`, fullPage: true }); }
}
// Workflows designer + deployments/canary (Phase 17)
for (const [n,p] of [["96-workflows","/workflows"],["97-knowledge","/knowledge"],["98-teams","/teams"]]) {
  await page.goto(BASE+p); await page.waitForLoadState("networkidle").catch(()=>{});
  await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
}
console.log("ERRORS:", errs.length); errs.slice(0,15).forEach(e=>console.log("  ",e));
await browser.close();
