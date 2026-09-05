import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ApprovalTierValue } from "@nextbot/contracts";
import { createHash } from "node:crypto";

export interface ToolRow {
  id: string;
  tenantId: string;
  /** `null` for a `kind = 'AgentAsTool'` entry (Phase 14/BL-46, LLD §14.7.1). */
  connectorId: string | null;
  /** Phase 14 (BL-46, FR-ORC-01). `'McpTool'` for every row that predates this
   * phase and for every discovered MCP tool. */
  kind: "McpTool" | "AgentAsTool";
  /** The pinned specialist version an `AgentAsTool` delegates to; `null` otherwise. */
  agentDefinitionVersionId: string | null;
  name: string;
  displayName: string | null;
  descriptionSource: string;
  descriptionOverride: string | null;
  rwClass: "Read" | "Write";
  approvalTier: ApprovalTierValue;
  visibleToAgent: boolean;
  priorityWeight: number;
  capabilityGroupId: string | null;
  status: "Active" | "Disabled" | "Error" | "Removed";
  circuitState: "Closed" | "Open" | "HalfOpen";
  lastCalledAt: Date | null;
}

/**
 * QA Defect U13: an explicit, stable `ORDER BY` (creation order, then id as a final
 * tie-break for rows created in the same instant) — without one, Postgres makes no
 * ordering guarantee at all, so the Tool Catalog's row order could visually shift
 * after an unrelated inline edit/reload even though nothing about the *data*
 * changed order-wise.
 */
/**
 * `allowedCapabilityGroupIds` (Phase 17, client-feedback-batch capability-group
 * enforcement): `undefined` (the default) applies NO capability-group restriction —
 * every pre-existing caller (Admin Console's Tool Catalog screen, the pre-Phase-17
 * turn pipeline) keeps its exact previous behavior. When the caller (`turn-pipeline.ts`,
 * for a version whose `toolPolicy.capabilityGroups` is non-empty) supplies a real
 * array — including an empty one, e.g. every configured name was stale/deleted — a
 * tool is included only if it has NO capability group assigned (`capability_group_id
 * IS NULL`, unaffected by this restriction per the Design Studio's own field hint) OR
 * its group is one of the ids supplied. This mirrors `permission-resolver.ts`'s
 * independent `capability_group_not_permitted` re-check at call time — this filter is
 * the efficiency/UX pre-filter (don't even show a restricted tool as selectable), the
 * resolver is the defense-in-depth backstop (never trust the pre-filtered catalog alone).
 */
export async function listTools(
  ctx: TenantContext,
  filters?: { connectorId?: string; allowedCapabilityGroupIds?: string[] },
): Promise<ToolRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.tool.tenantId, ctx.tenantId)];
    if (filters?.connectorId) conditions.push(eq(schema.tool.connectorId, filters.connectorId));
    if (filters?.allowedCapabilityGroupIds !== undefined) {
      conditions.push(or(isNull(schema.tool.capabilityGroupId), inArray(schema.tool.capabilityGroupId, filters.allowedCapabilityGroupIds))!);
    }
    return db
      .select()
      .from(schema.tool)
      .where(and(...conditions))
      .orderBy(asc(schema.tool.createdAt), asc(schema.tool.id));
  });
}

export async function findToolById(ctx: TenantContext, id: string): Promise<ToolRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.tool).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, id)));
    return rows[0] ?? null;
  });
}

export interface ToolSchemaVersionRow {
  id: string;
  toolId: string;
  versionOrdinal: number;
  inputSchema: object;
  outputSchema: object;
}

/** Phase 12 (BL-05): the turn pipeline's dispatch stage needs the tool's *current*
 * input/output JSON Schema to pass across `ports/egress.ts` (validated by
 * `@nextbot/mcp-client` at the gateway boundary — Ajv stays scoped there). */
export async function findCurrentSchemaVersion(ctx: TenantContext, toolId: string): Promise<ToolSchemaVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const toolRows = await db.select().from(schema.tool).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
    const tool = toolRows[0];
    if (!tool?.currentSchemaVersionId) return null;
    const rows = await db
      .select()
      .from(schema.toolSchemaVersion)
      .where(and(eq(schema.toolSchemaVersion.tenantId, ctx.tenantId), eq(schema.toolSchemaVersion.id, tool.currentSchemaVersionId)));
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      toolId: row.toolId,
      versionOrdinal: row.versionOrdinal,
      inputSchema: row.inputSchema as object,
      outputSchema: row.outputSchema as object,
    };
  });
}

export async function findToolByName(ctx: TenantContext, connectorId: string, name: string): Promise<ToolRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.tool)
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.connectorId, connectorId), eq(schema.tool.name, name)));
    return rows[0] ?? null;
  });
}

export interface UpsertToolInput {
  connectorId: string;
  name: string;
  descriptionSource: string;
  rwClass: "Read" | "Write";
  approvalTier: ApprovalTierValue;
  inputSchema: object;
  outputSchema: object;
}

/** FR-MCP-02/15: inserts a new tool + its first `tool_schema_version`, or — for an
 * already-known `(connectorId, name)` — appends a new schema version and flags
 * `breaking_change` if the schema changed in a way FR-MCP-15 calls breaking (a
 * removed property, a new required property, or a narrowed type/enum). Returns the
 * tool id and whether this call created a new tool vs. updated an existing one. */
export async function upsertToolFromDiscovery(
  ctx: TenantContext,
  input: UpsertToolInput,
): Promise<{ toolId: string; created: boolean; breakingChange: boolean }> {
  const schemaHash = hashSchemas(input.inputSchema, input.outputSchema);
  const existing = await findToolByName(ctx, input.connectorId, input.name);

  return withTenant(ctx, async (db: TenantScopedClient) => {
    if (!existing) {
      const toolId = generateId();
      const versionId = generateId();
      // `tool.current_schema_version_id` and `tool_schema_version.tool_id` are a
      // mutual FK pair — neither row can be inserted first while pointing at the
      // other, so `tool` is inserted with a NULL pointer, `tool_schema_version` is
      // inserted referencing the now-existing `tool` row, then `tool` is updated to
      // point at the version row that now exists. All three statements share this
      // one `withTenant` transaction, so no other reader ever observes the
      // momentarily-null pointer.
      await db.insert(schema.tool).values({
        id: toolId,
        tenantId: ctx.tenantId,
        connectorId: input.connectorId,
        name: input.name,
        descriptionSource: input.descriptionSource,
        currentSchemaVersionId: null,
        rwClass: input.rwClass,
        rwClassSource: "AutoHeuristic",
        approvalTier: input.approvalTier,
        approvalTierSource: "BackendTypeDefault",
      });
      await db.insert(schema.toolSchemaVersion).values({
        id: versionId,
        tenantId: ctx.tenantId,
        toolId,
        versionOrdinal: 1,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        schemaHash,
        breakingChange: false,
      });
      await db
        .update(schema.tool)
        .set({ currentSchemaVersionId: versionId })
        .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
      return { toolId, created: true, breakingChange: false };
    }

    const priorVersions = await db
      .select()
      .from(schema.toolSchemaVersion)
      .where(and(eq(schema.toolSchemaVersion.tenantId, ctx.tenantId), eq(schema.toolSchemaVersion.toolId, existing.id)));
    const latest = priorVersions.reduce((a, b) => (a.versionOrdinal > b.versionOrdinal ? a : b));

    if (latest.schemaHash === schemaHash) {
      return { toolId: existing.id, created: false, breakingChange: false };
    }

    const breaking = isBreakingChange(latest.inputSchema as object, input.inputSchema);
    const versionId = generateId();
    await db.insert(schema.toolSchemaVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      toolId: existing.id,
      versionOrdinal: latest.versionOrdinal + 1,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      schemaHash,
      breakingChange: breaking,
    });
    await db
      .update(schema.tool)
      .set({ currentSchemaVersionId: versionId, descriptionSource: input.descriptionSource, updatedAt: new Date() })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, existing.id)));

    return { toolId: existing.id, created: false, breakingChange: breaking };
  });
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — the
 * catalog-side half of "a specialist agent version is registered as an entry in the
 * existing Tool Catalog". Called only by `@nextbot/teams`'
 * `agent-tool-registrar.ts`; the naming/tier-derivation policy lives there, this
 * function is purely the persistence.
 *
 * Idempotent on `(tenantId, agentDefinitionVersionId)` — the partial unique index
 * `tool_tenant_agent_version_key` makes "one catalog entry per pinned specialist
 * version" a database invariant, and a second call for the same version returns the
 * existing row (re-activating it if it had been retired, and raising its
 * `approvalTier` if the caller now derives a stricter one — never lowering it).
 *
 * The synthetic `tool_schema_version` written here is LLD §14.7.1's exact
 * `{task, context?}` / `{outcome, text?, citations?}` pair, which is what lets Ajv
 * validation, the sandbox tester and the trace viewer all work UNCHANGED against a
 * delegation.
 */
export const AGENT_AS_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    task: { type: "string" },
    context: { type: "object" },
  },
  required: ["task"],
  additionalProperties: false,
} as const;

export const AGENT_AS_TOOL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["answered", "not_mine", "escalate"] },
    text: { type: "string" },
    citations: { type: "array" },
  },
  required: ["outcome"],
  additionalProperties: false,
} as const;

export interface UpsertAgentAsToolInput {
  agentDefinitionVersionId: string;
  /** `agent.<definitionName>` (LLD §14.7.1's naming rule). */
  name: string;
  descriptionSource: string;
  rwClass: "Read" | "Write";
  approvalTier: ApprovalTierValue;
}

export async function upsertAgentAsTool(ctx: TenantContext, input: UpsertAgentAsToolInput): Promise<ToolRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existingRows = await db
      .select()
      .from(schema.tool)
      .where(
        and(
          eq(schema.tool.tenantId, ctx.tenantId),
          eq(schema.tool.kind, "AgentAsTool"),
          eq(schema.tool.agentDefinitionVersionId, input.agentDefinitionVersionId),
        ),
      );
    const existing = existingRows[0];

    if (existing) {
      // Never lower an already-recorded tier — LLD §14.7.1's "defaulting
      // `approval_tier` from the specialist's own highest-tier reachable tool
      // (never lower)". An admin override made through the ordinary Tool Catalog
      // screen is therefore preserved if it is stricter.
      const tier = TIER_RANK[input.approvalTier] > TIER_RANK[existing.approvalTier] ? input.approvalTier : existing.approvalTier;
      const updated = await db
        .update(schema.tool)
        .set({ status: "Active", approvalTier: tier, descriptionSource: input.descriptionSource, updatedAt: new Date() })
        .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, existing.id)))
        .returning();
      return updated[0]!;
    }

    const toolId = generateId();
    const versionId = generateId();
    // Same three-statement dance `upsertToolFromDiscovery` uses for the genuine
    // `tool` <-> `tool_schema_version` FK cycle, in one transaction.
    await db.insert(schema.tool).values({
      id: toolId,
      tenantId: ctx.tenantId,
      connectorId: null,
      kind: "AgentAsTool",
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      name: input.name,
      descriptionSource: input.descriptionSource,
      currentSchemaVersionId: null,
      rwClass: input.rwClass,
      rwClassSource: "AutoHeuristic",
      approvalTier: input.approvalTier,
      approvalTierSource: "BackendTypeDefault",
    });
    await db.insert(schema.toolSchemaVersion).values({
      id: versionId,
      tenantId: ctx.tenantId,
      toolId,
      versionOrdinal: 1,
      inputSchema: AGENT_AS_TOOL_INPUT_SCHEMA,
      outputSchema: AGENT_AS_TOOL_OUTPUT_SCHEMA,
      schemaHash: hashSchemas(AGENT_AS_TOOL_INPUT_SCHEMA, AGENT_AS_TOOL_OUTPUT_SCHEMA),
      breakingChange: false,
    });
    // Seed the Tool-scoped `Allow` rule, exactly as `discoverAndSyncTools` seeds a
    // BackendType-default rule for a freshly-discovered MCP tool. Without this, a
    // brand-new team could never delegate at all: the resolver's step 8 fail-closed
    // default (`no_matching_rule`) would deny every hop, and an `AgentAsTool` has no
    // connector/backend-type scope for a broader rule to match against.
    //
    // `Allow` is NOT a tiering bypass — it resolves to `tier = tool.approval_tier`,
    // which is the derived floor (never lower than the specialist's own highest-tier
    // reachable tool). So a Tier-3-capable specialist's delegation still suspends
    // into the Approval Queue under this seeded rule. An admin can tighten or
    // replace it through the ordinary Tool Catalog permissions screen, and a
    // re-registration never overwrites what they authored (see the `existing`
    // branch above, which does not touch rules at all).
    await db.insert(schema.toolPermissionRule).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      scope: "Tool",
      toolId,
      ordinal: 0,
      conditions: {},
      effect: "Allow",
      enabled: true,
    });

    const rows = await db
      .update(schema.tool)
      .set({ currentSchemaVersionId: versionId })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)))
      .returning();
    return rows[0]!;
  });
}

/** Phase 14 (BL-46) — retires (never hard-deletes) an `AgentAsTool` entry when its
 * member is removed from every team version. Soft `status = 'Disabled'`, matching
 * how this catalog already handles a tool that must stop being selectable while its
 * `tool_call` history stays referentially intact. */
export async function retireAgentAsTool(ctx: TenantContext, toolId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.tool)
      .set({ status: "Disabled", visibleToAgent: false, updatedAt: new Date() })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId), eq(schema.tool.kind, "AgentAsTool")));
  });
}

const TIER_RANK: Record<ApprovalTierValue, number> = { Tier1: 1, Tier2: 2, Tier3: 3 };

export async function setToolVisibility(ctx: TenantContext, toolId: string, visible: boolean): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.tool)
      .set({ visibleToAgent: visible, updatedAt: new Date() })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
  });
}

export async function setToolPriorityWeight(ctx: TenantContext, toolId: string, priorityWeight: number): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.tool)
      .set({ priorityWeight, updatedAt: new Date() })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
  });
}

export async function setToolCapabilityGroup(ctx: TenantContext, toolId: string, capabilityGroupId: string | null): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.tool)
      .set({ capabilityGroupId, updatedAt: new Date() })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
  });
}

/**
 * Deterministic JSON serialization (object keys sorted recursively at every level,
 * array element order preserved as-is since order is semantically meaningful there).
 *
 * NOTE: an earlier version of this function passed `JSON.stringify(value,
 * Object.keys(value).sort())` — but `JSON.stringify`'s second argument, when an
 * array, is a **global allow-list of property names applied at every nesting
 * level**, not a per-level key-sort. Passing `["inputSchema", "outputSchema"]`
 * therefore silently stripped every nested key not literally named that (i.e.
 * `type`/`properties`/`required`/...), collapsing every schema to the same
 * near-empty string and making `schemaHash` identical for any two schemas sharing
 * the same top-level shape — which in turn made `upsertToolFromDiscovery` treat
 * every schema change as "unchanged" and never actually run breaking-change
 * detection. Caught by `tool-repository.int.test.ts`'s breaking-change assertion
 * failing against real behavior, not merely a type-level oversight.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashSchemas(inputSchema: object, outputSchema: object): string {
  const canonical = JSON.stringify(canonicalize({ inputSchema, outputSchema }));
  return createHash("sha256").update(canonical).digest("hex");
}

/** FR-MCP-15: breaking = a required property removed, a new required property added,
 * or an existing property's `type`/`enum` narrowed. Best-effort on a JSON-Schema-ish
 * object shape (`properties`, `required`) — arbitrary third-party schemas that don't
 * follow this shape are conservatively treated as breaking (fail toward re-review,
 * not toward silently accepting an unreviewable change). */
interface JsonSchemaLike {
  properties?: Record<string, { type?: unknown; enum?: unknown }>;
  required?: string[];
}

function isBreakingChange(prior: unknown, next: unknown): boolean {
  const priorSchema = prior as JsonSchemaLike | undefined;
  const nextSchema = next as JsonSchemaLike | undefined;
  const priorProps = priorSchema?.properties ?? {};
  const nextProps = nextSchema?.properties ?? {};
  const priorRequired: string[] = priorSchema?.required ?? [];
  const nextRequired: string[] = nextSchema?.required ?? [];

  const removedProperty = Object.keys(priorProps).some((k) => !(k in nextProps));
  const newRequiredProperty = nextRequired.some((k) => !priorRequired.includes(k));
  const narrowedType = Object.keys(priorProps).some((k) => {
    if (!(k in nextProps)) return false;
    const priorType = priorProps[k]?.type;
    const nextType = nextProps[k]?.type;
    return priorType && nextType && JSON.stringify(priorType) !== JSON.stringify(nextType);
  });

  return removedProperty || newRequiredProperty || narrowedType;
}
