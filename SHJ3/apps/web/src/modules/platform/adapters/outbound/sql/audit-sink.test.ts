import { describe, expect, it } from "vitest";
import {
  MissingTenantContextError,
  runWithTenant,
  type Principal,
  type TenantContext,
} from "../../../tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../../tenancy/tenant-slug.js";
import type { AuditActor, AuditEntry } from "../../../ports/provisioning.js";
import {
  PlatformAuditSink,
  TenantAuditSink,
  buildPlatformAuditCall,
  buildTenantAuditCall,
  type AuditCall,
  type AuditSqlExecutor,
} from "./audit-sink.js";

/**
 * Tests for the audit adapter's parameter-building logic.
 *
 * `usp_WriteAuditLogEntry` and its platform twin compute the hash chain — that
 * is exactly what makes it untestable, and unnecessary, to test here without a
 * database (a live-database round trip belongs in tests/integration). What this
 * file pins down instead is everything the adapter is actually responsible for:
 * that every value reaches the procedure as a bound `@P<n>` parameter rather
 * than interpolated text, that an actor snapshot is built correctly from either
 * half of `AuditActor`, that `correlationId` comes from `TenantContext.traceId`,
 * and that a value which cannot become JSON does not crash the write.
 *
 * Covers the audit-adapter portion of §4.13.
 */

const SEWA = assertValidSlugShape("sewa");

const PRINCIPAL: Principal = {
  id: "usr_01HZXKZK8N9P0Q1R2S3T4U5V6W",
  tenant: SEWA,
  displayName: "Noura Al Marzooqi",
  roles: ["Super Admin", "Entity Admin"],
  permissions: new Set(),
  assurance: "L2",
};

const PRINCIPAL_ACTOR: AuditActor = { kind: "Principal", principal: PRINCIPAL };
const SYSTEM_ACTOR: AuditActor = { kind: "System", label: "Tenant Migration Orchestrator" };

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: PRINCIPAL_ACTOR,
    action: "tenant.provision",
    target: { kind: "Tenant", labelSnapshot: "sewa" },
    summary: 'Tenant "sewa" provisioned across all four stores.',
    environmentKey: "development",
    ...overrides,
  };
}

/** Every bound value in the order the shared 15 parameters are declared. */
function sharedValues(call: AuditCall): readonly unknown[] {
  return call.params.slice(0, 15);
}

// ---------------------------------------------------------------------------
// buildTenantAuditCall
// ---------------------------------------------------------------------------

describe("buildTenantAuditCall", () => {
  it("names the schema-qualified tenant procedure", () => {
    const call = buildTenantAuditCall("sewa", entry(), "trace_01");
    expect(call.sql).toContain("[sewa].[usp_WriteAuditLogEntry]");
  });

  it("binds every value positionally, in the procedure's declared order", () => {
    const call = buildTenantAuditCall(
      "sewa",
      entry({
        target: { kind: "Tenant", id: "tnt_01ABCDEFGHIJKLMNOPQRSTUVWX", labelSnapshot: "sewa" },
        requestId: "req_01ABCDEFGHIJKLMNOPQRSTUVWX",
        ipHash: "a".repeat(64),
        userAgentHash: "b".repeat(64),
      }),
      "trace_01",
    );

    expect(sharedValues(call)).toEqual([
      PRINCIPAL.id,
      PRINCIPAL.displayName,
      "Super Admin",
      "tenant.provision",
      "Tenant",
      "tnt_01ABCDEFGHIJKLMNOPQRSTUVWX",
      "sewa",
      'Tenant "sewa" provisioned across all four stores.',
      "trace_01",
      "development",
      null, // beforeJson
      null, // afterJson
      "req_01ABCDEFGHIJKLMNOPQRSTUVWX",
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("propagates correlationId as the 9th bound parameter", () => {
    const call = buildTenantAuditCall("sewa", entry(), "trace_specific");
    expect(call.params[8]).toBe("trace_specific");
  });

  it("carries no platform-only columns", () => {
    const call = buildTenantAuditCall("sewa", entry(), "trace_01");
    expect(call.params).toHaveLength(15);
    expect(call.sql).not.toContain("tenantId");
  });

  it("re-derives the schema string only from what it is given — callers must pass an already-validated name", () => {
    // safeSchemaName's own re-validation is tested in sql-script.test.ts; this
    // adapter trusts its caller (TenantAuditSink) to have called it already,
    // exactly as sql-store-provisioner.ts trusts safeSchemaName's callers.
    const call = buildTenantAuditCall("customs", entry(), "trace_01");
    expect(call.sql).toContain("[customs].[usp_WriteAuditLogEntry]");
  });
});

// ---------------------------------------------------------------------------
// buildPlatformAuditCall
// ---------------------------------------------------------------------------

describe("buildPlatformAuditCall", () => {
  it("names the platform procedure", () => {
    const call = buildPlatformAuditCall(entry(), "trace_01");
    expect(call.sql).toContain("[platform].[usp_WritePlatformAuditLogEntry]");
  });

  it("appends tenantId and tenantSlugSnapshot after the 15 shared parameters", () => {
    const call = buildPlatformAuditCall(
      entry({ tenant: { id: "tnt_01ABCDEFGHIJKLMNOPQRSTUVWX", slugSnapshot: "sewa" } }),
      "trace_01",
    );
    expect(call.params).toHaveLength(17);
    expect(call.params[15]).toBe("tnt_01ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(call.params[16]).toBe("sewa");
  });

  it("binds both as null when the entry names no tenant — a genuinely cross-tenant action", () => {
    const call = buildPlatformAuditCall(entry(), "trace_01");
    expect(call.params[15]).toBeNull();
    expect(call.params[16]).toBeNull();
  });

  it("accepts a slug snapshot with no tenant id — CK_..._tenantSnapshotPaired allows that direction", () => {
    const call = buildPlatformAuditCall(entry({ tenant: { slugSnapshot: "sewa" } }), "trace_01");
    expect(call.params[15]).toBeNull();
    expect(call.params[16]).toBe("sewa");
  });
});

// ---------------------------------------------------------------------------
// Actor snapshots
// ---------------------------------------------------------------------------

describe("actor snapshot", () => {
  it("freezes a Principal's displayName and primary (first) role", () => {
    const call = buildTenantAuditCall("sewa", entry({ actor: PRINCIPAL_ACTOR }), "trace_01");
    expect(call.params[0]).toBe(PRINCIPAL.id);
    expect(call.params[1]).toBe("Noura Al Marzooqi");
    expect(call.params[2]).toBe("Super Admin");
  });

  it("falls back to a labelled placeholder role for a Principal with no roles", () => {
    const bare: Principal = { ...PRINCIPAL, roles: [] };
    const call = buildTenantAuditCall(
      "sewa",
      entry({ actor: { kind: "Principal", principal: bare } }),
      "trace_01",
    );
    expect(call.params[2]).toBe("(no role)");
  });

  it("records a system actor with no staffUserId and the label as the display name", () => {
    const call = buildTenantAuditCall("sewa", entry({ actor: SYSTEM_ACTOR }), "trace_01");
    expect(call.params[0]).toBeNull();
    expect(call.params[1]).toBe("Tenant Migration Orchestrator");
    expect(call.params[2]).toBe("System");
  });
});

// ---------------------------------------------------------------------------
// JSON serialisation edge cases
// ---------------------------------------------------------------------------

describe("beforeJson / afterJson serialisation", () => {
  it("serialises a plain object", () => {
    const call = buildTenantAuditCall(
      "sewa",
      entry({ after: { embeddingModel: "text-embedding-3-large" } }),
      "trace_01",
    );
    expect(call.params[11]).toBe(JSON.stringify({ embeddingModel: "text-embedding-3-large" }));
  });

  it("binds undefined as null rather than the literal string", () => {
    const call = buildTenantAuditCall("sewa", entry({ before: undefined }), "trace_01");
    expect(call.params[10]).toBeNull();
  });

  it("does not throw on a circular structure, and records why instead of losing the entry", () => {
    // JSON.stringify throws on a circular reference. beforeJson/afterJson must
    // still end up valid JSON (CK_..._isJson), so this cannot simply be dropped.
    const circular: Record<string, unknown> = { name: "sewa" };
    circular.self = circular;

    expect(() =>
      buildTenantAuditCall("sewa", entry({ after: circular }), "trace_01"),
    ).not.toThrow();

    const call = buildTenantAuditCall("sewa", entry({ after: circular }), "trace_01");
    const parsed = JSON.parse(call.params[11] as string);
    expect(parsed.note).toContain("could not be serialised");
  });

  it("does not throw on a BigInt, which JSON.stringify also refuses", () => {
    const call = buildTenantAuditCall("sewa", entry({ after: { count: 10n } }), "trace_01");
    expect(() => JSON.parse(call.params[11] as string)).not.toThrow();
  });

  it("handles a value with no JSON representation at all (a bare function) without throwing", () => {
    // JSON.stringify *returns* undefined for this input rather than throwing —
    // a distinct case from the circular/BigInt one, and both must resolve to
    // valid JSON rather than reaching the driver as the value undefined.
    const call = buildTenantAuditCall(
      "sewa",
      entry({ after: (() => "unserialisable") as unknown }),
      "trace_01",
    );
    const parsed = JSON.parse(call.params[11] as string);
    expect(parsed.note).toContain("no JSON representation");
  });
});

// ---------------------------------------------------------------------------
// The adapters, against a fake executor — no database required.
// ---------------------------------------------------------------------------

function fakeSqlExecutor(): AuditSqlExecutor & { calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
    },
  };
}

function contextFor(overrides: Partial<TenantContext> = {}): TenantContext {
  return { tenant: SEWA, principal: null, traceId: "trace_ctx_01", ...overrides };
}

describe("TenantAuditSink", () => {
  it("derives the schema and correlationId from the bound tenant context", async () => {
    const sql = fakeSqlExecutor();
    const sink = new TenantAuditSink({ sql });

    await runWithTenant(contextFor({ traceId: "trace_ctx_specific" }), () => sink.record(entry()));

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]!.sql).toContain("[sewa].[usp_WriteAuditLogEntry]");
    expect(sql.calls[0]!.params[8]).toBe("trace_ctx_specific");
  });

  it("refuses to write outside a bound tenant context rather than guessing a correlationId", async () => {
    const sink = new TenantAuditSink({ sql: fakeSqlExecutor() });
    await expect(sink.record(entry())).rejects.toThrow(MissingTenantContextError);
  });
});

describe("PlatformAuditSink", () => {
  it("calls the platform procedure and derives correlationId from the bound context", async () => {
    const sql = fakeSqlExecutor();
    const sink = new PlatformAuditSink({ sql });

    await runWithTenant(contextFor({ platformScope: "provisioning" }), () =>
      sink.record(entry({ tenant: { slugSnapshot: "sewa" } })),
    );

    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0]!.sql).toContain("[platform].[usp_WritePlatformAuditLogEntry]");
    expect(sql.calls[0]!.params[8]).toBe("trace_ctx_01");
    expect(sql.calls[0]!.params[16]).toBe("sewa");
  });

  it("refuses to write outside a bound tenant context", async () => {
    const sink = new PlatformAuditSink({ sql: fakeSqlExecutor() });
    await expect(sink.record(entry())).rejects.toThrow(MissingTenantContextError);
  });
});
