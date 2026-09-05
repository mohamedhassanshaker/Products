/**
 * Phase 18 (BL-11) cross-process breaker test fixture — run as a genuinely
 * separate `node`/`tsx` process (see `circuit-breaker-cross-process.int.test.ts`),
 * not imported into the test process. Imports the exact same real
 * `recordBreakerOutcome` this dispatch's egress paths call, so the trip this
 * script performs is indistinguishable from a real `apps/gateway` process
 * tripping the breaker — it's the same code, same Redis connection convention,
 * just a different OS process.
 */
import { recordBreakerOutcome, BREAKER_TRIP_THRESHOLD } from "../circuit-breaker.js";
import { _resetBreakerRedisClientForTests } from "../redis-client.js";

const [, , tenantId, toolId] = process.argv;
if (!tenantId || !toolId) {
  console.error("usage: trip-breaker-in-child-process.ts <tenantId> <toolId>");
  process.exit(1);
}

for (let i = 0; i < BREAKER_TRIP_THRESHOLD; i++) {
  await recordBreakerOutcome(tenantId, toolId, false);
}
await _resetBreakerRedisClientForTests();
