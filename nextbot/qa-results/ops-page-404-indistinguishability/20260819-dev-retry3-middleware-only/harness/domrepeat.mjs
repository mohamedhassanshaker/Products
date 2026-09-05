import { chromium } from "playwright";
const b = await chromium.launch();
for (const path of ["/internal/xps","/internal/ops","/internal/xps","/internal/ops","/nope","/internal/ops","/internal/xps","/nope"]) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3491${path}`, { waitUntil: "networkidle" });
  const h = await p.content();
  console.log(path, h.length, /6077-d75f0a5dd8c285de/.test(h) ? "has-async-scripts" : "no-async-scripts");
  await ctx.close();
}
await b.close();
