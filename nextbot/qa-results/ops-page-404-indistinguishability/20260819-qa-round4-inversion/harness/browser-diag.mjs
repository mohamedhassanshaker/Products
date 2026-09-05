import { chromium } from "file:///D:/work/products/nextbot/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";
const OUT = process.argv[2];
const ALLOWED = "http://127.0.0.1:3492";
const TOKEN = "test-operator-token-abc123";
const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.5" } });
const page = await ctx.newPage();
const bad = [];
const all = [];
page.on("response", async (r) => {
  all.push(r.status() + " " + r.request().method() + " " + r.url());
  if (r.status() >= 400) {
    let b = "";
    try { b = (await r.text()).slice(0, 200); } catch {}
    bad.push({ status: r.status(), url: r.url(), method: r.request().method(), body: b, reqHeaders: Object.keys(r.request().headers()).join(",") });
  }
});
page.on("requestfailed", (r) => bad.push({ status: "FAILED", url: r.url(), err: r.failure() && r.failure().errorText }));

await page.goto(ALLOWED + "/internal/ops/login", { waitUntil: "networkidle" });
await page.fill('input[name="token"]', TOKEN);
await Promise.all([page.waitForURL("**/internal/ops/tenants", { timeout: 30000 }), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(2500);
console.log("cookies:", JSON.stringify((await ctx.cookies()).map((c) => c.name + " path=" + c.path + " secure=" + c.secure + " sameSite=" + c.sameSite + " httpOnly=" + c.httpOnly)));
console.log("\nfailed/4xx responses:");
for (const b of bad) console.log("  " + JSON.stringify(b));
console.log("\nin-page fetch of the ops API from the console origin:");
const apiRes = await page.evaluate(async () => {
  const r = await fetch("/api/internal/ops/tenants");
  return { status: r.status, body: (await r.text()).slice(0, 250) };
});
console.log("  " + JSON.stringify(apiRes));
console.log("\nrendered rows:", await page.locator("table tbody tr").count(), "| body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400));
await page.screenshot({ path: OUT + "/10-tenants-diagnostic.png", fullPage: true });

console.log("\n--- SPA nav check: click 'Provision new tenant' ---");
let hardNav = 0;
page.on("load", () => hardNav++);
const before = hardNav;
const link = page.getByRole("link", { name: /provision new tenant/i });
console.log("  link count(role=link):", await link.count(), "| any element with text:", await page.getByText(/provision new tenant/i).count());
const target = (await link.count()) ? link.first() : page.getByText(/provision new tenant/i).first();
await target.click();
await page.waitForTimeout(2500);
console.log("  url now:", page.url(), "| document 'load' events since click:", hardNav - before, "(0 == SPA transition)");
console.log("  slug field:", await page.locator('input[name="slug"]').count());
await page.screenshot({ path: OUT + "/11-provision-diagnostic.png", fullPage: true });
console.log("\nall responses after nav (last 12):");
for (const r of all.slice(-12)) console.log("  " + r);
await browser.close();
