/**
 * The real `DemoDataSeeder` for `tools`.
 *
 * `ensureNativeSkill`/`ensureMcpServer`/`ensureApiConnector` compose the
 * already-reviewed `Prisma{Skill,McpServer,ApiConnector}Repository` adapters
 * rather than re-deriving their logic a second time — `PrismaSkillRepository`'s
 * key-disambiguation loop, `PrismaMcpServerRepository`'s discovery upsert-by-name
 * transaction, and `PrismaApiConnectorRepository`'s rate-limit-policy-then-
 * connector transaction (plus its trigger-projected-skill lookup) are exactly
 * the kind of logic a hand-rolled duplicate risks silently drifting from. This
 * class only adds what those ordinary ports do not already provide: an
 * idempotent "find by name, else create (then bring to the seeded state)"
 * wrapper — see `ports/demo-data-seeder.ts`'s own module comment for the full
 * reasoning, including why `CircuitBreakerConfig` (no ordinary `create()` at
 * all) is written directly instead.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  DemoDataSeeder,
  NewApiConnectorSeed,
  NewCircuitBreakerSeed,
  NewMcpServerSeed,
  NewSkillSeed,
} from "../../../ports/demo-data-seeder.js";
import { PrismaApiConnectorRepository } from "./prisma-api-connector-repository.js";
import { PrismaMcpServerRepository } from "./prisma-mcp-server-repository.js";
import { PrismaSkillRepository } from "./prisma-skill-repository.js";

const OPERATION = "tools demo data seeder";

export class PrismaDemoDataSeeder implements DemoDataSeeder {
  private readonly skills = new PrismaSkillRepository();
  private readonly mcpServers = new PrismaMcpServerRepository();
  private readonly apiConnectors = new PrismaApiConnectorRepository();

  async ensureNativeSkill(input: NewSkillSeed, now: Date): Promise<string> {
    const existing = (await this.skills.list()).find((row) => row.name === input.name);
    if (existing) return existing.id;

    const created = await this.skills.createNative({
      name: input.name,
      description: input.description,
      category: input.category,
      inputSchemaJson: input.inputSchemaJson,
      outputSchemaJson: null,
      isAttachedByDefault: input.isAttachedByDefault,
      now,
    });
    return created.id;
  }

  async ensureMcpServer(input: NewMcpServerSeed, now: Date): Promise<string> {
    const existing = (await this.mcpServers.list()).find((row) => row.name === input.name);
    if (existing) return existing.id;

    const created = await this.mcpServers.create({
      name: input.name,
      endpoint: input.endpoint,
      transport: input.transport,
      authMode: input.authMode,
      credentialSecretRef: input.credentialSecretRef,
      now,
    });
    if (input.discoveredTools.length > 0) {
      await this.mcpServers.recordSuccessfulDiscovery(created.id, input.discoveredTools, now);
    }
    return created.id;
  }

  async ensureApiConnector(input: NewApiConnectorSeed, now: Date): Promise<string> {
    const existing = (await this.apiConnectors.list()).find((row) => row.name === input.name);
    if (existing) return existing.id;

    const created = await this.apiConnectors.create({
      name: input.name,
      method: input.method,
      urlTemplate: input.urlTemplate,
      authMode: input.authMode,
      credentialSecretRef: input.credentialSecretRef,
      headersJson: null,
      requestSchemaJson: null,
      responseSchemaJson: null,
      timeoutMs: input.timeoutMs,
      rateLimitPolicy: input.rateLimitPolicy,
      now,
    });
    if (input.seededSampleResponseJson !== undefined) {
      await this.apiConnectors.recordTestResult(
        created.id,
        { ok: true, sampleResponseJson: input.seededSampleResponseJson },
        now,
      );
    }
    return created.id;
  }

  async ensureCircuitBreaker(input: NewCircuitBreakerSeed, now: Date): Promise<string> {
    const db = getTenantDb(OPERATION);
    const existing = await db.circuitBreakerConfig.findFirst({
      where: { targetKind: input.targetKind, targetId: input.targetId, targetKey: input.targetKey },
    });
    if (existing) return existing.id;

    const created = await db.circuitBreakerConfig.create({
      data: {
        id: newUlid(now),
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetKey: input.targetKey,
        failureThreshold: input.failureThreshold,
        windowSeconds: input.windowSeconds,
        cooldownSeconds: input.cooldownSeconds,
        halfOpenProbes: input.halfOpenProbes,
        fallbackStrategy: input.fallbackStrategy,
        cachedAnswerMaxAgeSeconds: input.cachedAnswerMaxAgeSeconds,
        serveCachedWhenDown: input.serveCachedWhenDown,
        degradedModeMessage: input.degradedModeMessage,
        isEnabled: input.isEnabled,
        createdAt: now,
        updatedAt: now,
      },
    });
    return created.id;
  }
}
