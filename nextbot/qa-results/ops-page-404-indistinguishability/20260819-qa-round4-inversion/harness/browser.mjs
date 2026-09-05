import { chromium } from "file:///D:/work/products/nextbot/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs";

const OUT = process.argv[2];
const ALLOWED = "http://127.0.0.1:3492";
const DENIED = "http://127.0.0.1:3491";
const TOKEN = "test-operator-token-abc123";
const SECRET = "nb-c-4f21c8a7e3d9b605";
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const opCtx = await browser.newContext({ extraHTTPHeaders: { "X-Forwarded-For": "203.0.113.5" } });
const page = await opCtx.newPage();
const consoleErrors = [];
const requests = [];
const fullLoads = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("request", (r) => requests.push({ url: r.url(), referer: r.headers()["referer"] || "", type: r.resourceType() }));
page.on("framenavigated", (f) => { if (f === page.mainFrame()) fullLoads.push(f.url()); });

async function shot(n) { await page.screenshot({ path: OUT + "/" + n + ".png", fullPage: true }); }

log("### 1. login page");
await page.goto(ALLOWED + "/internal/ops/login", { waitUntil: "networkidle" });
log("  url:", page.url(), "| title:", await page.title(), "| token field:", await page.locator('input[name="token"]').count());
await shot("01-login");

log("### 2. wrong token");
await page.fill('input[name="token"]', "wrong-token");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
log("  url:", page.url(), "| body:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 120));
await shot("02-login-invalid-token");

log("### 3. correct token -> tenants");
await page.fill('input[name="token"]', TOKEN);
await Promise.all([page.waitForURL("**/internal/ops/tenants", { timeout: 30000 }), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");
log("  url:", page.url());
log("  shell 'Platform Manager' visible:", await page.getByText("Platform Manager").first().isVisible().catch(() => false));
const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
log("  body text:", bodyText.slice(0, 300));
log("  nav Tenants href:", await page.getByRole("link", { name: "Tenants" }).first().getAttribute("href").catch(() => "n/a"));
await shot("03-tenants");

log("### 4. URL / history / referer leakage of the secret segment");
log("  url contains secret:", page.url().includes(SECRET));
const hist = await page.evaluate(() => ({ len: history.length, href: location.href, ref: document.referrer }));
log("  history.length:", hist.len, "| location.href:", hist.href, "| document.referrer:", JSON.stringify(hist.ref));
const leakyReq = requests.filter((r) => r.referer.includes(SECRET));
log("  requests whose Referer header carried the secret:", leakyReq.length);
const secretUrlReq = requests.filter((r) => r.url.includes(SECRET));
log("  requests whose URL carried the secret:", secretUrlReq.length, secretUrlReq.slice(0, 4).map((r) => r.type + " " + r.url.replace(ALLOWED, "")).join(" | "));

log("### 5. SPA navigation (no full reload)");
const loadsBefore = fullLoads.length;
const provision = page.getByRole("link", { name: /provision/i }).first();
if (await provision.count()) {
  await provision.click();
  await page.waitForURL("**/internal/ops/tenants/new", { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  log("  url after client nav:", page.url(), "| slug field:", await page.locator('input[name="slug"]').count());
  log("  main-frame navigations during click:", fullLoads.length - loadsBefore, "(1 == SPA history push, >1 or full document load == hard nav)");
  const navType = await page.evaluate(() => performance.getEntriesByType("navigation").map((n) => n.name + ":" + n.type).join(","));
  log("  performance navigation entries:", navType);
  await shot("04-provision-form");
  await page.goBack();
  await page.waitForURL("**/internal/ops/tenants", { timeout: 30000 });
  log("  url after back:", page.url());
} else {
  log("  !! provision link not found; body:", bodyText.slice(0, 200));
}

log("### 6. operator mistypes a console path");
await page.goto(ALLOWED + "/internal/ops/definitely-not-a-console-page", { waitUntil: "networkidle" });
log("  url:", page.url(), "| text:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80));
await shot("05-operator-mistyped");

log("### 7. operator requests the secret path directly");
const r7 = await page.goto(ALLOWED + "/internal/ops/" + SECRET + "/tenants", { waitUntil: "networkidle" });
log("  status:", r7.status(), "| url:", page.url(), "| text:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 60));
await shot("06-operator-secret-path");

log("### 8. sign out");
await page.goto(ALLOWED + "/internal/ops/tenants", { waitUntil: "networkidle" });
const signout = page.getByRole("button", { name: /sign out/i });
log("  sign-out button present:", await signout.count());
if (await signout.count()) {
  await signout.click();
  await page.waitForURL("**/internal/ops/login", { timeout: 30000 });
  log("  url after sign out:", page.url(), "| token field:", await page.locator('input[name="token"]').count());
  await shot("07-after-signout");
  const r9 = await page.goto(ALLOWED + "/internal/ops/tenants", { waitUntil: "networkidle" });
  log("  revisiting /tenants after sign out -> status", r9.status(), "url", page.url());
  await shot("08-after-signout-tenants-redirect");
}

log("\n  browser console errors during operator flow (" + consoleErrors.length + "):");
for (const e of consoleErrors.slice(0, 10)) log("   -", e.slice(0, 200));
await opCtx.close();

log("\n### 9. denied caller in a real browser: gated vs genuinely missing");
const anonCtx = await browser.newContext();
const anon = await anonCtx.newPage();
const seen = [];
for (const p of ["/internal/ops", "/internal/ops/login", "/internal/ops/tenants", "/internal/ops/" + SECRET + "/tenants", "/internal/xps/tenants", "/definitely-nothing-here"]) {
  const res = await anon.goto(DENIED + p, { waitUntil: "networkidle" });
  const html = await anon.content();
  seen.push({ p, status: res.status(), title: await anon.title(), text: (await anon.locator("body").innerText()).replace(/\s+/g, " ").trim(), htmlLen: html.length, hasSecret: html.includes(SECRET) });
  await anon.screenshot({ path: OUT + "/09-denied" + p.replace(/\W+/g, "-") + ".png" });
}
for (const s of seen) log(" ", JSON.stringify(s));
log("  distinct rendered views:", new Set(seen.map((s) => s.status + "|" + s.title + "|" + s.text + "|" + s.htmlLen)).size, "(1 == indistinguishable in-browser)");
log("  any page HTML leaking the secret to a denied caller:", seen.some((s) => s.hasSecret));
await anonCtx.close();
await browser.close();
