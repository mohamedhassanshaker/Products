/**
 * Composition root for `/knowledge` (B6: Knowledge / Graph RAG) — mirrors `tools/
 * composition.ts` and `agents/composition.ts` exactly: the one place in this route allowed
 * to name concrete adapters, so every use case below it receives ports only.
 */

import { AiServiceKnowledgeClient } from "../../../../modules/knowledge/adapters/outbound/ai/ai-service-knowledge-client.js";
import { PrismaChunkRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-chunk-repository.js";
import { PrismaConflictRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-conflict-repository.js";
import { PrismaGraphRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-graph-repository.js";
import { PrismaKnowledgeSourceRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-knowledge-source-repository.js";
import { PrismaOutboxRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-outbox-repository.js";
import { PrismaReconciliationRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-reconciliation-repository.js";
import { PrismaReindexJobRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-reindex-job-repository.js";
import { PrismaRetrievalConfigRepository } from "../../../../modules/knowledge/adapters/outbound/sql/prisma-retrieval-config-repository.js";

export function knowledgeSourceRepository(): PrismaKnowledgeSourceRepository {
  return new PrismaKnowledgeSourceRepository();
}
export function chunkRepository(): PrismaChunkRepository {
  return new PrismaChunkRepository();
}
export function graphRepository(): PrismaGraphRepository {
  return new PrismaGraphRepository();
}
export function retrievalConfigRepository(): PrismaRetrievalConfigRepository {
  return new PrismaRetrievalConfigRepository();
}
export function reindexJobRepository(): PrismaReindexJobRepository {
  return new PrismaReindexJobRepository();
}
export function conflictRepository(): PrismaConflictRepository {
  return new PrismaConflictRepository();
}
export function outboxRepository(): PrismaOutboxRepository {
  return new PrismaOutboxRepository();
}
export function reconciliationRepository(): PrismaReconciliationRepository {
  return new PrismaReconciliationRepository();
}
export function knowledgeAiClient(): AiServiceKnowledgeClient {
  return new AiServiceKnowledgeClient();
}

export function now(): Date {
  return new Date();
}
