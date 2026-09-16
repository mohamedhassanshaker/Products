/**
 * The real `ApiConnectorRepository` — `ApiConnectors`/`RateLimitPolicies`/(the trigger-
 * projected) `Skills`, per-tenant.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isApiConnectorAuthMode,
  isApiConnectorMethod,
  isApiConnectorTestState,
  type ApiConnectorAuthMode,
  type ApiConnectorMethod,
} from "../../../domain/tool-catalog.js";
import type {
  ApiConnectorRepository,
  ApiConnectorRow,
  DeleteApiConnectorResult,
  NewApiConnectorInput,
} from "../../../ports/api-connector-repository.js";

const OPERATION = "tools api connector repository";

async function findProjectedSkillId(
  db: ReturnType<typeof getTenantDb>,
  apiConnectorId: string,
): Promise<string> {
  const skill = await db.skill.findFirst({ where: { apiConnectorId } });
  if (!skill) {
    throw new Error(
      `No Skill row was projected for ApiConnector ${apiConnectorId} — ` +
        "TR_ApiConnectors_projectSkill should have created one on insert. This is a real, unexpected gap, not an application-layer decision.",
    );
  }
  return skill.id;
}

function toConnectorRow(
  row: {
    id: string;
    name: string;
    method: string;
    urlTemplate: string;
    authMode: string;
    credentialSecretRef: string | null;
    headersJson: string | null;
    requestSchemaJson: string | null;
    responseSchemaJson: string | null;
    timeoutMs: number;
    testState: string;
    lastTestedAt: Date | null;
    sampleResponseJson: string | null;
    rateLimitPolicyId: string;
  },
  projectedSkillId: string,
): ApiConnectorRow {
  if (
    !isApiConnectorMethod(row.method) ||
    !isApiConnectorAuthMode(row.authMode) ||
    !isApiConnectorTestState(row.testState)
  ) {
    throw new Error(`ApiConnector ${row.id} has an unrecognized method/authMode/testState.`);
  }
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    urlTemplate: row.urlTemplate,
    authMode: row.authMode,
    credentialSecretRef: row.credentialSecretRef,
    headersJson: row.headersJson,
    requestSchemaJson: row.requestSchemaJson,
    responseSchemaJson: row.responseSchemaJson,
    timeoutMs: row.timeoutMs,
    testState: row.testState,
    lastTestedAt: row.lastTestedAt,
    sampleResponseJson: row.sampleResponseJson,
    rateLimitPolicyId: row.rateLimitPolicyId,
    projectedSkillId,
  };
}

export class PrismaApiConnectorRepository implements ApiConnectorRepository {
  async list(): Promise<readonly ApiConnectorRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.apiConnector.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return Promise.all(
      rows.map(async (row) => toConnectorRow(row, await findProjectedSkillId(db, row.id))),
    );
  }

  async get(id: string): Promise<ApiConnectorRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.apiConnector.findFirst({ where: { id, deletedAt: null } });
    if (!row) return null;
    return toConnectorRow(row, await findProjectedSkillId(db, row.id));
  }

  async create(input: NewApiConnectorInput): Promise<ApiConnectorRow> {
    const db = getTenantDb(OPERATION);
    const { now } = input;
    const connectorId = newUlid(now);
    const policyId = newUlid(new Date(now.getTime() + 1));

    // The policy must exist before the connector references it (ApiConnectors.
    // rateLimitPolicyId is NOT NULL) — created first, in the same transaction.
    await db.$transaction([
      db.rateLimitPolicy.create({
        data: {
          id: policyId,
          name: input.rateLimitPolicy.name,
          requestsPerWindow: input.rateLimitPolicy.requestsPerWindow,
          windowSeconds: input.rateLimitPolicy.windowSeconds,
          burst: input.rateLimitPolicy.burst,
          scope: input.rateLimitPolicy.scope,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.apiConnector.create({
        data: {
          id: connectorId,
          name: input.name,
          method: input.method,
          urlTemplate: input.urlTemplate,
          authMode: input.authMode,
          credentialSecretRef: input.credentialSecretRef,
          headersJson: input.headersJson,
          requestSchemaJson: input.requestSchemaJson,
          responseSchemaJson: input.responseSchemaJson,
          timeoutMs: input.timeoutMs,
          testState: "Untested",
          lastTestedAt: null,
          sampleResponseJson: null,
          rateLimitPolicyId: policyId,
          createdAt: now,
          updatedAt: now,
        },
      }),
      // TR_ApiConnectors_projectSkill fires on the insert above and creates the paired
      // Skill row as part of the SAME statement's trigger execution — nothing further to
      // do here; findProjectedSkillId (below) re-reads it.
    ]);

    const created = await db.apiConnector.findFirstOrThrow({ where: { id: connectorId } });
    return toConnectorRow(created, await findProjectedSkillId(db, connectorId));
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly method?: ApiConnectorMethod;
      readonly urlTemplate?: string;
      readonly authMode?: ApiConnectorAuthMode;
      readonly credentialSecretRef?: string | null;
      readonly headersJson?: string | null;
      readonly requestSchemaJson?: string | null;
      readonly responseSchemaJson?: string | null;
      readonly timeoutMs?: number;
    },
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    const requestShapeChanged =
      input.method !== undefined || input.urlTemplate !== undefined || input.authMode !== undefined;

    const current = await db.apiConnector.findFirstOrThrow({ where: { id } });
    const nextName = input.name ?? current.name;
    const nextRequestSchemaJson =
      input.requestSchemaJson !== undefined ? input.requestSchemaJson : current.requestSchemaJson;
    const nextResponseSchemaJson =
      input.responseSchemaJson !== undefined
        ? input.responseSchemaJson
        : current.responseSchemaJson;

    await db.$transaction([
      db.apiConnector.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.method !== undefined ? { method: input.method } : {}),
          ...(input.urlTemplate !== undefined ? { urlTemplate: input.urlTemplate } : {}),
          ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
          ...(input.credentialSecretRef !== undefined
            ? { credentialSecretRef: input.credentialSecretRef }
            : {}),
          ...(input.headersJson !== undefined ? { headersJson: input.headersJson } : {}),
          ...(input.requestSchemaJson !== undefined
            ? { requestSchemaJson: input.requestSchemaJson }
            : {}),
          ...(input.responseSchemaJson !== undefined
            ? { responseSchemaJson: input.responseSchemaJson }
            : {}),
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
          // "Changing method, endpoint or auth resets tested to false — the badge must
          // never claim a test that covered a different request" (docs/api.md §6.5).
          ...(requestShapeChanged ? { testState: "Untested" as const, lastTestedAt: null } : {}),
          updatedAt: now,
        },
      }),
      // TR_ApiConnectors_projectSkill only re-syncs `deletedAt` on UPDATE, never `name`/
      // schemas/`rateLimitPolicyId` (a real, confirmed gap — see tasks/todo.md's B-3
      // review). Closed here at the application layer rather than left to drift silently.
      db.skill.updateMany({
        where: { apiConnectorId: id },
        data: {
          name: nextName,
          inputSchemaJson: nextRequestSchemaJson ?? "{}",
          outputSchemaJson: nextResponseSchemaJson,
          updatedAt: now,
        },
      }),
    ]);
  }

  async softDelete(id: string, now: Date): Promise<DeleteApiConnectorResult> {
    const db = getTenantDb(OPERATION);
    const activeBindings = await db.toolBinding.findMany({
      where: {
        isEnabled: true,
        OR: [{ apiConnectorId: id }, { skill: { apiConnectorId: id } }],
      },
      select: { agentVersionId: true },
    });
    if (activeBindings.length > 0) {
      return {
        ok: false,
        reason: "tools.connector_in_use",
        boundAgentVersionIds: activeBindings.map((b) => b.agentVersionId),
      };
    }
    // The trigger cascades deletedAt onto the paired Skill on its own UPDATE path.
    await db.apiConnector.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
    return { ok: true };
  }

  async recordTestResult(
    id: string,
    result: { readonly ok: boolean; readonly sampleResponseJson: string | null },
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.apiConnector.update({
      where: { id },
      data: {
        testState: result.ok ? "Tested" : "Failed",
        lastTestedAt: now,
        sampleResponseJson: result.sampleResponseJson,
        updatedAt: now,
      },
    });
  }
}
