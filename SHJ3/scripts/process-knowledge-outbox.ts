/**
 * Standing polling loop for the knowledge outbox (§9.2) — stands in for the `shj3-worker`
 * deployment named in `docs/architecture.md`/`docs/data-model.md`. **No separate worker
 * deployable exists yet in this repo** (confirmed: nothing under `docker/`/`chart/`
 * defines a `shj3-worker` workload) — building that full Kubernetes Deployment is out of
 * this wave's scope. This script is the honest, real stand-in: a long-running Node process
 * that loops `ProcessKnowledgeOutbox` on an interval, across every active tenant, until it
 * receives a shutdown signal.
 *
 *   pnpm exec tsx scripts/process-knowledge-outbox.ts
 *
 * Not wired into `package.json` as a one-shot `db:seed:*`-style script — it does not exit
 * on its own. An operator (or a future container entrypoint) runs it directly, or it is
 * exec'd as a container's main process once a real `shj3-worker` Deployment exists.
 *
 * **This is not the only place the outbox gets drained.** `apps/web`'s `addSourceAction`/
 * `recrawlSourceAction` Server Actions also drain a batch synchronously, inline, right
 * after their own write — so a demo does not depend on this loop being up at all. Both are
 * real, deliberate, and documented in `(backoffice)/knowledge/actions.ts`'s own module
 * comment: the inline call is for immediate feedback in one browser tab; this loop is for
 * everything else (a second admin's tab, a source added via a future integration, a
 * previously `Failed` row whose backoff has elapsed).
 */

import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { PrismaTenantRegistry } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  type TenantSlug,
} from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { ProcessKnowledgeOutbox } from "../apps/web/src/modules/knowledge/application/process-knowledge-outbox.js";
import { PrismaOutboxRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-outbox-repository.js";
import { PrismaChunkRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-chunk-repository.js";
import { PrismaGraphRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-graph-repository.js";
import { PrismaRetrievalConfigRepository } from "../apps/web/src/modules/knowledge/adapters/outbound/sql/prisma-retrieval-config-repository.js";
import { AiServiceKnowledgeClient } from "../apps/web/src/modules/knowledge/adapters/outbound/ai/ai-service-knowledge-client.js";

const POLL_INTERVAL_MS = Number(process.env.SHJ3_KNOWLEDGE_OUTBOX_POLL_MS ?? 5_000);
const BATCH_SIZE = Number(process.env.SHJ3_KNOWLEDGE_OUTBOX_BATCH_SIZE ?? 64);
const WORKER_ID = `knowledge-outbox-worker-${process.pid}`;

let shuttingDown = false;

function newTraceId(): string {
  return `knowledge-outbox-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Every `Active` tenant, listed via the platform registry (a platform-scoped, audited read — ADR-0002 rule 5, the same provisioning-class access every seed script already uses). */
async function listActiveTenantSlugs(): Promise<readonly TenantSlug[]> {
  return runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: newTraceId(),
      platformScope: "provisioning",
    },
    async () => {
      const registry = new PrismaTenantRegistry();
      const active = await registry.listActive();
      return active.map((tenant) => assertValidSlugShape(tenant.slug));
    },
  );
}

async function processOneTenant(tenant: TenantSlug): Promise<void> {
  await runWithTenant({ tenant, principal: null, traceId: newTraceId() }, async () => {
    const result = await new ProcessKnowledgeOutbox({
      outbox: new PrismaOutboxRepository(),
      chunks: new PrismaChunkRepository(),
      graph: new PrismaGraphRepository(),
      retrievalConfig: new PrismaRetrievalConfigRepository(),
      ai: new AiServiceKnowledgeClient(),
    }).execute({ batchSize: BATCH_SIZE, workerId: WORKER_ID, now: new Date() });

    if (result.claimed > 0) {
      console.info(
        `[process-knowledge-outbox] tenant "${tenant}": claimed=${result.claimed} applied=${result.applied} failed=${result.failed}`,
      );
    }
  });
}

async function pollOnce(): Promise<void> {
  const tenants = await listActiveTenantSlugs();
  for (const tenant of tenants) {
    if (shuttingDown) return;
    try {
      await processOneTenant(tenant);
    } catch (error) {
      // One tenant's failure must not stop the loop from serving every other tenant.
      console.error(`[process-knowledge-outbox] tenant "${tenant}" failed this cycle:`, error);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.info(
    `[process-knowledge-outbox] starting — poll interval ${POLL_INTERVAL_MS}ms, batch size ${BATCH_SIZE}, worker id ${WORKER_ID}`,
  );

  const shutdown = (signal: string) => {
    console.info(
      `[process-knowledge-outbox] received ${signal}, shutting down after the current cycle...`,
    );
    shuttingDown = true;
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  while (!shuttingDown) {
    await pollOnce();
    if (shuttingDown) break;
    await sleep(POLL_INTERVAL_MS);
  }

  await disconnectAllTenantDbs();
  await disconnectCache();
  console.info("[process-knowledge-outbox] stopped.");
}

main().catch((error: unknown) => {
  console.error("[process-knowledge-outbox] fatal error:", error);
  process.exitCode = 1;
});
