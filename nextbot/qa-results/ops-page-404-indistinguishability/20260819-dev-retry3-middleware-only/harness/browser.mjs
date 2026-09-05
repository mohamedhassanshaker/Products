import { chromium } from "playwright";

const OUT = process.argv[2];
const ALLOWED = "http://127.0.0.1:3492";
const DENIED = "http://127.0.0.1:3491";
const TOKEN = "test-operator-token-abc123";

const log = (...a) => console.log(...a);

const browser = await chromium.launch();

// --- allowed operator (behind a trusted proxy that sets an allow-listed XFF) -----------
const opCtx = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.5" } });
const page = await opCtx.newPage();
page.on("console", (m) => m.type() === "error" && log("  [browser console error]", m.text()));

await page.goto(`${ALLOWED}/internal/ops/login`, { waitUntil: "networkidle" });
log("login page url:", page.url(), "| title:", await page.title());
log("  has token field:", await page.locator('input[name="token"]').count());
await page.screenshot({ path: `${OUT}/b1-login.png`, fullPage: true });

await page.fill('input[name="token"]', TOKEN);
await Promise.all([page.waitForURL("**/internal/ops/tenants", { timeout: 20000 }), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");
log("after login url:", page.url());
log("  Platform Manager visible:", await page.getByText("Platform Manager").first().isVisible());
const nav = page.getByRole("link", { name: "Tenants" });
log("  nav href:", await nav.getAttribute("href"), "| aria-current:", await nav.getAttribute("aria-current"));
log("  heading:", (await page.locator("h1, h2").first().textContent())?.trim());
await page.screenshot({ path: `${OUT}/b2-tenants.png`, fullPage: true });

// client-side navigation through the rewrite
const provision = page.getByRole("link", { name: /provision/i }).first();
if (await provision.count()) {
  await provision.click();
  await page.waitForURL("**/internal/ops/tenants/new", { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  log("client-side nav url:", page.url(), "| slug field:", await page.locator('input[name="slug"]').count());
  await page.screenshot({ path: `${OUT}/b3-provision.png`, fullPage: true });
  await page.goBack();
  await page.waitForURL("**/internal/ops/tenants", { timeout: 20000 });
  log("back nav url:", page.url());
} else {
  log("client-side nav: provision link not found on page");
}

await page.goto(`${ALLOWED}/internal/ops/definitely-not-a-console-page`, { waitUntil: "networkidle" });
log("operator mistyped url:", page.url(), "| text:", (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 80));
await page.screenshot({ path: `${OUT}/b4-operator-mistyped.png`, fullPage: true });

// logout closes the loop
await page.goto(`${ALLOWED}/internal/ops/tenants`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /sign out/i }).click();
await page.waitForURL("**/internal/ops/login", { timeout: 20000 });
log("after logout url:", page.url(), "| token field:", await page.locator('input[name="token"]').count());
await page.screenshot({ path: `${OUT}/b5-after-logout.png`, fullPage: true });
await opCtx.close();

// --- denied caller: gated path vs genuinely missing path -------------------------------
const anonCtx = await browser.newContext();
const anon = await anonCtx.newPage();
const seen = [];
for (const p of ["/internal/ops", "/internal/ops/tenants", "/internal/ops/login", "/internal/xps/tenants", "/definitely-nothing-here"]) {
  const res = await anon.goto(`${DENIED}${p}`, { waitUntil: "networkidle" });
  const body = (await anon.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const html = await anon.content();
  seen.push({ p, status: res.status(), title: await anon.title(), body, htmlLen: html.length });
  await anon.screenshot({ path: `${OUT}/b6${p.replace(/\W+/g, "-")}.png` });
}
log("\ndenied-vs-missing browser view:");
for (const s of seen) log(" ", JSON.stringify(s));
log("distinct rendered views:", new Set(seen.map((s) => `${s.status}|${s.title}|${s.body}|${s.htmlLen}`)).size);
await anonCtx.close();

await browser.close();
