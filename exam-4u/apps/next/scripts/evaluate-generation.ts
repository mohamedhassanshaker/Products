/**
 * Generation-quality evaluation harness CLI (migration plan Phase 6, sub-slice "6d") — this app's own
 * port of legacy's identical `evaluate-generation.ts` CLI-only tool. Runs the fixed
 * `GOLDEN_SET` (`server/pdf-processing/evaluation/golden-set.ts`) against the real `AiServicePort` for
 * a given tenant, prints the resulting `EvaluationReport` as JSON.
 *
 * **Manually invoked only** — never run from application code, never scheduled. Each run calls the
 * real AI model for every golden item (a handful of real token-costing calls), so it must never be
 * wired into a route, a worker tick, or a test suite's own automated run.
 *
 * In THIS environment, `AI_ENABLED=false` (no live `OPENROUTER_API_KEY` — the same finding every prior
 * Phase 5/6 sub-slice dispatch already recorded), so every golden item's `AiServicePort` call throws
 * `AiDisabledError` — caught per-item by `GenerationEvaluationService.runOne`, surfaced as
 * `failed: true` for all 4 items rather than crashing the whole run. This is a genuine, honest
 * end-to-end exercise of the harness's per-item failure-isolation contract and its join against the
 * (real, possibly-empty) historical calibration report; it does not exercise the real
 * `calibrateConfidence` scoring path for a live model output (unreachable in this environment).
 *
 * Run (after `npm run provision-phase3-demo-tenant`):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npx tsx scripts/evaluate-generation.ts [tenantSubdomain=demo-phase3]
 */
import { randomUUID } from 'node:crypto';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { runWithRequestContext } from '@/server/context';
import { getGenerationEvaluationService } from '@/server/pdf-processing';

const TENANT_SUBDOMAIN = process.argv[2]?.trim().toLowerCase() || process.env.DEMO_TENANT_SUBDOMAIN?.trim().toLowerCase() || 'demo-phase3';

async function main(): Promise<void> {
  const platformDs = await getPlatformDataSource();
  const tenantRow = await platformDs.query('SELECT id, schema_name FROM tenant WHERE subdomain_slug = ? LIMIT 1', [TENANT_SUBDOMAIN]);
  if (tenantRow.length === 0) {
    throw new Error(`No tenant found for subdomain '${TENANT_SUBDOMAIN}' — run 'npm run provision-phase3-demo-tenant' first.`);
  }
  const { id: tenantId, schema_name: schemaName } = tenantRow[0] as { id: string; schema_name: string };

  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(schemaName);
  try {
    const report = await runWithRequestContext(
      { requestId: randomUUID(), tenantId, tenantSlug: TENANT_SUBDOMAIN, tenantSchema: schemaName, tenantDataSource: dataSource },
      () => getGenerationEvaluationService().run(tenantId),
    );
    // eslint-disable-next-line no-console -- CLI script's own user-facing output, not application logging.
    console.log(JSON.stringify(report, null, 2));
  } finally {
    registry.release(schemaName);
    await platformDs.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI script's own user-facing error output.
  console.error(err);
  process.exitCode = 1;
});
