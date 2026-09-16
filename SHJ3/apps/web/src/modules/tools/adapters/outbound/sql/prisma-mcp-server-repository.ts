/** The real `McpServerRepository` — `McpServers`/`McpTools`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isMcpAuthMode,
  isMcpConnectionState,
  isMcpTransport,
  type McpAuthMode,
  type McpTransport,
} from "../../../domain/tool-catalog.js";
import type {
  DeleteMcpServerResult,
  McpServerRepository,
  McpServerRow,
  McpToolRow,
  NewMcpServerInput,
} from "../../../ports/mcp-server-repository.js";

const OPERATION = "tools mcp server repository";

function toServerRow(row: {
  id: string;
  name: string;
  endpoint: string;
  transport: string;
  authMode: string;
  credentialSecretRef: string | null;
  connectionState: string;
  lastDiscoveryAt: Date | null;
  lastConnectedAt: Date | null;
  lastError: string | null;
}): McpServerRow {
  if (
    !isMcpTransport(row.transport) ||
    !isMcpAuthMode(row.authMode) ||
    !isMcpConnectionState(row.connectionState)
  ) {
    throw new Error(`McpServer ${row.id} has an unrecognized transport/authMode/connectionState.`);
  }
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    transport: row.transport,
    authMode: row.authMode,
    credentialSecretRef: row.credentialSecretRef,
    connectionState: row.connectionState,
    lastDiscoveryAt: row.lastDiscoveryAt,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
  };
}

function toToolRow(row: {
  id: string;
  mcpServerId: string;
  name: string;
  description: string | null;
  inputSchemaJson: string;
  discoveredAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
}): McpToolRow {
  return { ...row };
}

export class PrismaMcpServerRepository implements McpServerRepository {
  async list(): Promise<readonly McpServerRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.mcpServer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toServerRow);
  }

  async get(id: string): Promise<McpServerRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.mcpServer.findFirst({ where: { id, deletedAt: null } });
    return row ? toServerRow(row) : null;
  }

  async create(input: NewMcpServerInput): Promise<McpServerRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.mcpServer.create({
      data: {
        id: newUlid(input.now),
        name: input.name,
        endpoint: input.endpoint,
        transport: input.transport,
        authMode: input.authMode,
        credentialSecretRef: input.credentialSecretRef,
        connectionState: "NotConnected",
        lastDiscoveryAt: null,
        lastConnectedAt: null,
        lastError: null,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toServerRow(row);
  }

  async update(
    id: string,
    input: {
      readonly name?: string;
      readonly endpoint?: string;
      readonly transport?: McpTransport;
      readonly authMode?: McpAuthMode;
      readonly credentialSecretRef?: string | null;
    },
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    const endpointOrAuthChanged = input.endpoint !== undefined || input.authMode !== undefined;

    await db.$transaction([
      db.mcpServer.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
          ...(input.transport !== undefined ? { transport: input.transport } : {}),
          ...(input.authMode !== undefined ? { authMode: input.authMode } : {}),
          ...(input.credentialSecretRef !== undefined
            ? { credentialSecretRef: input.credentialSecretRef }
            : {}),
          // "Changing either marks the server not_connected and invalidates its discovered
          // descriptors — a descriptor set from a different endpoint is a lie" (docs/api.md §6.5).
          ...(endpointOrAuthChanged ? { connectionState: "NotConnected" as const } : {}),
          updatedAt: now,
        },
      }),
      ...(endpointOrAuthChanged
        ? [
            db.mcpTool.updateMany({
              where: { mcpServerId: id, removedAt: null },
              data: { removedAt: now, updatedAt: now },
            }),
          ]
        : []),
    ]);
  }

  async softDelete(id: string, now: Date): Promise<DeleteMcpServerResult> {
    const db = getTenantDb(OPERATION);
    const activeBindings = await db.toolBinding.findMany({
      where: { mcpTool: { mcpServerId: id }, isEnabled: true },
      select: { agentVersionId: true },
    });
    if (activeBindings.length > 0) {
      return {
        ok: false,
        reason: "tools.server_in_use",
        boundAgentVersionIds: activeBindings.map((b) => b.agentVersionId),
      };
    }
    await db.mcpServer.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
    return { ok: true };
  }

  async listTools(mcpServerId: string): Promise<readonly McpToolRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.mcpTool.findMany({
      where: { mcpServerId, removedAt: null },
      orderBy: { name: "asc" },
    });
    return rows.map(toToolRow);
  }

  async recordSuccessfulDiscovery(
    mcpServerId: string,
    discovered: readonly {
      readonly name: string;
      readonly description: string | null;
      readonly inputSchemaJson: string;
    }[],
    now: Date,
  ): Promise<readonly McpToolRow[]> {
    const db = getTenantDb(OPERATION);
    const existing = await db.mcpTool.findMany({ where: { mcpServerId } });
    const existingByName = new Map(existing.map((t) => [t.name, t]));
    const discoveredNames = new Set(discovered.map((d) => d.name));

    let tick = 0;
    const stamp = () => new Date(now.getTime() + tick++);

    const ops = [
      db.mcpServer.update({
        where: { id: mcpServerId },
        data: {
          connectionState: "Connected" as const,
          lastDiscoveryAt: now,
          lastConnectedAt: now,
          lastError: null,
          updatedAt: now,
        },
      }),
      // A previously-discovered tool absent from this pass is marked removed, never hard-
      // deleted — "bindings referencing it must remain resolvable so a trace stays readable".
      ...existing
        .filter((t) => t.removedAt === null && !discoveredNames.has(t.name))
        .map((t) =>
          db.mcpTool.update({ where: { id: t.id }, data: { removedAt: now, updatedAt: now } }),
        ),
      ...discovered.map((d) => {
        const existingTool = existingByName.get(d.name);
        if (existingTool) {
          return db.mcpTool.update({
            where: { id: existingTool.id },
            data: {
              description: d.description,
              inputSchemaJson: d.inputSchemaJson,
              lastSeenAt: now,
              removedAt: null,
              updatedAt: now,
            },
          });
        }
        return db.mcpTool.create({
          data: {
            id: newUlid(stamp()),
            mcpServerId,
            name: d.name,
            description: d.description,
            inputSchemaJson: d.inputSchemaJson,
            discoveredAt: now,
            lastSeenAt: now,
            removedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      }),
    ];

    await db.$transaction(ops);
    return this.listTools(mcpServerId);
  }

  async recordConnectionFailure(
    mcpServerId: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.mcpServer.update({
      where: { id: mcpServerId },
      data: { connectionState: "Failed", lastError: errorMessage, updatedAt: now },
    });
  }
}
