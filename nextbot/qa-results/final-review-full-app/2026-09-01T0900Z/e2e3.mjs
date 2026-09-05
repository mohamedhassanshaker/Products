import { chromium } from "file:///C:/Users/m.hassan/AppData/Local/npm-cache/_npx/bbb8a2c4738e2b0c/node_modules/playwright/index.mjs";
const BASE="http://localhost:3000", SHOTS="qa-results/final-review-full-app/2026-09-01T0900Z/shots";
const errs=[]; const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1600,height:1200}}); const p=await c.newPage();
p.on("console",m=>{if(m.type()==="error")errs.push(m.text());}); p.on("pageerror",e=>errs.push("PAGEERR "+e.message));
await p.goto(`${BASE}/login`);
await p.fill('input[name="tenantSlug"], input[name="tenant"]',"demo").catch(()=>{});
await p.fill('input[type="email"], input[name="email"]',"admin@demo.nextbot.local");
await p.fill('input[type="password"], input[name="password"]',"NextbotDemo!2026");
await p.click('button[type="submit"]'); await p.waitForURL(/dashboard/,{timeout:30000});
const id="01a05b17-970b-7b21-8e6c-05c72bde7eca";
for (const [n,u] of [["95-agent-design-studio",`/agent-platform/definitions/${id}/versions/studio`]]) {
  const r=await p.goto(BASE+u); await p.waitForLoadState("networkidle").catch(()=>{});
  console.log(u,"status=",r&&r.status());
  console.log("  H1:",(await p.locator("h1").first().textContent().catch(()=>null)||"").trim());
  console.log("  STEP:",(await p.getByText(/Step 1 of/).first().textContent().catch(()=>null)||"").trim());
  await p.screenshot({path:`${SHOTS}/${n}.png`,fullPage:true});
}
console.log("ERRORS:",errs.length); errs.slice(0,10).forEach(e=>console.log("  ",e));
await b.close();
