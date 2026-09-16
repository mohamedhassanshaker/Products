/**
 * SQL adapters for `AuditSink` (§4.13).
 *
 * The hash chain — `entryHash = SHA256(prevHash || sequenceNo || occurredAt ||
 * actor || action || target || summary)`, serialised against concurrent writers
 * with `WITH (UPDLOCK, HOLDLOCK)` — is computed by `usp_WriteAuditLogEntry` and
 * its platform-schema twin `usp_WritePlatformAuditLogEntry`
 * (prisma/sql/001_constraints.sql), never by this module. Computing it here
 * instead would defeat the reason the procedure exists: two round trips (read
 * the last hash, then insert) from application code cannot be serialised against
 * a concurrent writer the way one locked, single-writer procedure call can, so a
 * TypeScript-side hash would be tamper-*hideable* rather than tamper-*evident*.
 * This module's job is narrower and mechanical — gather the right parameters,
 * bind them, call the procedure.
 *
 * ## Two adapters, one shape
 *
 * `PlatformAuditSink` calls `[platform].[usp_WritePlatformAuditLogEntry]` via
 * `getPlatformDb()`; `TenantAuditSink` calls `[{{SCHEMA}}].[usp_WriteAuditLogEntry]`
 * via `getTenantDb()`, schema-qualified with the calling tenant's own schema
 * because raw SQL text gets none of Prisma's per-client schema binding — only
 * queries built from the Prisma Client API do (`tenant-db.ts`). Both read
 * `TenantContext.traceId` as `correlationId`, so an entry is traceable back to
 * the request that produced it (architecture.md §10, B14 tab 3).
 *
 * ## Why parameters are bound, not interpolated
 *
 * Every value below reaches SQL Server as a positional `@P<n>` parameter, the
 * same mechanism `sql-store-provisioner.ts` uses for `COUNT_SCHEMA` /
 * `COUNT_TABLES`. The one piece of this module that is *not* a bound value is
 * the tenant schema name in the procedure's own identifier — and that follows
 * `sql-script.ts`'s rule exactly: derived from an already-validated `TenantSlug`,
 * re-checked at the point of use, never from raw input.
 */

import { requireTenantContext } from "../../../tenancy/tenant-context.js";
import type { AuditActor, AuditEntry, AuditSink } from "../../../ports/provisioning.js";
import { safeSchemaName } from "./sql-script.js";
import { getPlatformDb, getTenantDb } from "./tenant-db.js";

/**
 * The narrow slice of raw SQL access this adapter needs.
 *
 * Extracted for the same reason `RawSqlExecutor` is in `sql-store-provisioner.ts`:
 * it makes the parameter-building logic below — actor snapshots, JSON
 * serialisation, correlation id propagation — testable without a database, while
 * the real implementation stays the only thing that touches `$executeRawUnsafe`.
 */
export interface AuditSqlExecutor {
  /** Run one bound `EXEC` call. `params[i]` binds to `@P<i+1>` in `sql`. */
  execute(sql: string, params: readonly unknown[]): Promise<void>;
}

/** SQL text plus its bound parameters, in `@P<n>` order. */
export interface AuditCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const OPERATION = "audit write";

// ---------------------------------------------------------------------------
// Parameter building — pure, and covered by audit-sink.test.ts without a
// database.
// ---------------------------------------------------------------------------

/**
 * Serialise a caller-supplied detail value for `beforeJson` / `afterJson`.
 *
 * `undefined` means "omit the column" and stays `undefined` (bound as SQL
 * `NULL`). Anything else must become valid JSON or the write itself would
 * violate `CK_..._beforeJson_isJson` / `CK_..._afterJson_isJson` and take the
 * audited action down with it — which an audit write must never do. Two failure
 * shapes are handled, not one: `JSON.stringify` *returns* `undefined` for a bare
 * function or symbol (no representation at all) rather than throwing, and it
 * *throws* for a circular structure or a `BigInt`. Both fall back to a small
 * JSON marker instead of losing the entry.
 */
function toJsonColumn(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    return json === undefined
      ? JSON.stringify({ note: "value has no JSON representation", type: typeof value })
      : json;
  } catch {
    return JSON.stringify({ note: "value could not be serialised to JSON", type: typeof value });
  }
}

/**
 * The `actorStaffUserId` / `actorDisplayNameSnapshot` / `actorRoleSnapshot` trio,
 * from either half of `AuditActor`.
 */
function actorSnapshot(actor: AuditActor): {
  readonly staffUserId: string | undefined;
  readonly displayNameSnapshot: string;
  readonly roleSnapshot: string;
} {
  if (actor.kind === "System") {
    return { staffUserId: undefined, displayNameSnapshot: actor.label, roleSnapshot: "System" };
  }
  const { principal } = actor;
  return {
    staffUserId: principal.id,
    displayNameSnapshot: principal.displayName,
    // "The primary role" (design intent): a principal holds one or more B9
    // roles, and the first is what the snapshot freezes. A principal with none
    // is a bootstrap or service account — recorded as such, not a crash.
    roleSnapshot: principal.roles[0] ?? "(no role)",
  };
}

/** `undefined` binds oddly across drivers; SQL `NULL` is what an optional param means here. */
function nullForUndefined(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** The 15 parameters both procedures share, in the order they are declared. */
function sharedParams(entry: AuditEntry, correlationId: string): unknown[] {
  const snapshot = actorSnapshot(entry.actor);
  return [
    snapshot.staffUserId,
    snapshot.displayNameSnapshot,
    snapshot.roleSnapshot,
    entry.action,
    entry.target.kind,
    entry.target.id,
    entry.target.labelSnapshot,
    entry.summary,
    correlationId,
    entry.environmentKey,
    toJsonColumn(entry.before),
    toJsonColumn(entry.after),
    entry.requestId,
    entry.ipHash,
    entry.userAgentHash,
  ];
}

const SHARED_PARAM_ASSIGNMENTS = `
  @actorStaffUserId = @P1, @actorDisplayNameSnapshot = @P2, @actorRoleSnapshot = @P3,
  @action = @P4, @targetKind = @P5, @targetId = @P6, @targetLabelSnapshot = @P7,
  @summary = @P8, @correlationId = @P9, @environmentKey = @P10, @beforeJson = @P11,
  @afterJson = @P12, @requestId = @P13, @ipHash = @P14, @userAgentHash = @P15`;

/**
 * Build the bound `EXEC` call for `[{{SCHEMA}}].[usp_WriteAuditLogEntry]`.
 *
 * `schema` must already be a re-validated schema name (`safeSchemaName`) — it
 * lands in identifier position, where no parameter binding exists.
 */
export function buildTenantAuditCall(
  schema: string,
  entry: AuditEntry,
  correlationId: string,
): AuditCall {
  return {
    sql: `EXEC [${schema}].[usp_WriteAuditLogEntry]${SHARED_PARAM_ASSIGNMENTS}`,
    params: sharedParams(entry, correlationId).map(nullForUndefined),
  };
}

/** Build the bound `EXEC` call for `[platform].[usp_WritePlatformAuditLogEntry]`. */
export function buildPlatformAuditCall(entry: AuditEntry, correlationId: string): AuditCall {
  const params = [
    ...sharedParams(entry, correlationId),
    entry.tenant?.id,
    entry.tenant?.slugSnapshot,
  ].map(nullForUndefined);

  return {
    sql: `EXEC [platform].[usp_WritePlatformAuditLogEntry]${SHARED_PARAM_ASSIGNMENTS},
  @tenantId = @P16, @tenantSlugSnapshot = @P17`,
    params,
  };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const platformExecutor: AuditSqlExecutor = {
  async execute(sql, params) {
    await getPlatformDb(OPERATION).$executeRawUnsafe(sql, ...params);
  },
};

const tenantExecutor: AuditSqlExecutor = {
  async execute(sql, params) {
    await getTenantDb(OPERATION).$executeRawUnsafe(sql, ...params);
  },
};

export interface AuditSinkOptions {
  /** Defaults to the real Prisma-backed executor. Overridden in tests only. */
  readonly sql?: AuditSqlExecutor;
}

/**
 * Writes `platform.PlatformAuditLogEntries` — tenant provisioning, migration
 * runs, and the rest of ADR-0002 rule 5's two sanctioned cross-tenant paths.
 */
export class PlatformAuditSink implements AuditSink {
  private readonly sql: AuditSqlExecutor;

  constructor(options: AuditSinkOptions = {}) {
    this.sql = options.sql ?? platformExecutor;
  }

  async record(entry: AuditEntry): Promise<void> {
    const correlationId = requireTenantContext(OPERATION).traceId;
    const { sql, params } = buildPlatformAuditCall(entry, correlationId);
    await this.sql.execute(sql, params);
  }
}

/** Writes `<tenant>.AuditLogEntries` — every ordinary, tenant-scoped audited action. */
export class TenantAuditSink implements AuditSink {
  private readonly sql: AuditSqlExecutor;

  constructor(options: AuditSinkOptions = {}) {
    this.sql = options.sql ?? tenantExecutor;
  }

  async record(entry: AuditEntry): Promise<void> {
    const context = requireTenantContext(OPERATION);
    const schema = safeSchemaName(context.tenant);
    const { sql, params } = buildTenantAuditCall(schema, entry, context.traceId);
    await this.sql.execute(sql, params);
  }
}
