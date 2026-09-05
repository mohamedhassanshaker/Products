import { startWorker } from "./index.js";

/**
 * Real process entry point (`node dist/main.js` in the container, or `tsx
 * src/main.ts` in dev) — see `index.ts`'s module doc for the job registry and
 * why `index.ts` itself stays side-effect-free.
 */
const schedule = startWorker();
console.log("NextBot worker: scheduler started.");

process.on("SIGTERM", () => {
  console.log("NextBot worker: SIGTERM received, stopping scheduler.");
  schedule.stop();
  process.exit(0);
});
