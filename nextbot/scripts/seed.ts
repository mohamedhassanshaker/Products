import { provisionTenant } from "@nextbot/tenancy";
import { seedSystemRoles, registerUser, EmailAlreadyRegisteredError } from "@nextbot/iam";
import {
  handleRegisterModelProvider,
  handleCreateDefinition,
  handleListDefinitions,
  handleCreateVersion,
  handleCreateEvalSuite,
  handleAddEvalCase,
  handleBindEvalSuite,
  handlePromoteVersion,
  handleRunEvalSuite,
  recordSandboxTest,
} from "@nextbot/agent-platform";
import { withPlatform } from "@nextbot/db/platform-only";
import { withTenant, generateId, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import * as schema from "@nextbot/db/schema";
import { and, eq } from "drizzle-orm";
import { findConnectorByName } from "@nextbot/connectors";
import { declareCatalogEntry, createRoute, createRouteVersion } from "@nextbot/model-gateway";
import { classifyReadWrite, defaultApprovalTier, listCapabilityGroups, createCapabilityGroup } from "@nextbot/tool-registry";
import type { BackendTypeValue, McpTransportValue, ConnectorAuthMethodValue } from "@nextbot/contracts";
import type { StdioCommand } from "@nextbot/db/schema";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Deployment-phase first-boot seed: creates one default tenant plus one ready-to-use
 * login for each of the six system roles (`packages/modules/iam/src/domain/
 * system-roles.ts`) so `docker compose up` gives an immediately explorable Admin
 * Console with no manual provisioning step.
 *
 * Idempotent by design (safe to re-run on every `docker compose up`, not just the
 * first one):
 *  - `provisionTenant()` throws `TenantAlreadyExistsError` on a name/slug collision —
 *    caught here and treated as "already seeded", not a failure.
 *  - `seedSystemRoles()` is itself idempotent (no-op per already-existing role name).
 *  - `registerUser()` throws `EmailAlreadyRegisteredError` on a duplicate email —
 *    caught and skipped per-user, so a partially-seeded tenant (e.g. a prior run that
 *    crashed halfway through the user loop) can be safely completed by re-running.
 *
 * This is a one-shot init-container script (`docker compose run --rm seed`), not
 * application code — it uses the same public application-service functions the real
 * Admin Console onboarding flow calls, just invoked directly instead of through an
 * HTTP handler, so there is nothing here that isn't already exercised by the
 * product's own tested code paths.
 */

const TENANT_NAME = "NextBot Demo";
const TENANT_SLUG = "demo";
const TENANT_REGION = "UAE" as const;
const TENANT_PLAN = "Enterprise" as const;
const DEFAULT_LANGUAGE = "en";
const DEMO_PASSWORD = "NextbotDemo!2026";

// The Platform Manager console (NFR-11) isn't DB-seeded — its operator token is an
// env var, defaulted directly in docker-compose.yml's `x-shared-env` anchor for a
// zero-config local stack (see docs/deployment/DEPLOYMENT.md "Testing the Platform
// Manager console locally"). Documented here, alongside every other seeded
// credential, using the exact same default the compose file falls back to, so a
// user who never set `.env.docker`'s NEXTBOT_OPS_OPERATOR_TOKEN still sees the
// token their running container is actually using rather than a placeholder that
// wouldn't work.
const DEFAULT_OPS_OPERATOR_TOKEN = "632438c7ae617a5c6a22eaad8dfaf7452847c7c1798b724297bf2f9d32471d8c";

// One login per seeded system role (LLD §3.3 / system-roles.ts) so every portal and
// permission level is reachable immediately after first boot.
const SEED_USERS: Array<{ email: string; displayName: string; roleName: string }> = [
  { email: "admin@demo.nextbot.local", displayName: "Demo Tenant Admin", roleName: "Tenant Admin" },
  { email: "backend-owner@demo.nextbot.local", displayName: "Demo Backend System Owner", roleName: "Backend System Owner" },
  { email: "designer@demo.nextbot.local", displayName: "Demo Designer", roleName: "Designer" },
  { email: "platform-engineer@demo.nextbot.local", displayName: "Demo Platform Engineer", roleName: "Platform Engineer" },
  { email: "escalation-agent@demo.nextbot.local", displayName: "Demo Escalation Agent", roleName: "Escalation Agent" },
  { email: "read-only@demo.nextbot.local", displayName: "Demo Read-Only", roleName: "Read-Only" },
];

async function findExistingTenant(): Promise<{ id: string } | null> {
  return withPlatform(async (db) => {
    const rows = await db
      .select({ id: schema.tenant.id })
      .from(schema.tenant)
      .where(eq(schema.tenant.slug, TENANT_SLUG));
    return rows[0] ?? null;
  });
}

/**
 * Resolves a seeded user's id by email within `ctx`'s tenant. `registerUser()` only
 * returns an id on the branch where it actually inserts a new row — on a re-run where
 * the user already exists (`EmailAlreadyRegisteredError`), this is how the caller
 * still gets a real id to hand to `createAgentDefinitionVersion`/`promoteAgentVersion`
 * below (both need a genuine, existing `app_user.id`, not a placeholder), without
 * needing a public export from `@nextbot/iam` beyond what it already exposes.
 */
async function findUserIdByEmail(ctx: TenantContext, email: string): Promise<string | null> {
  return withTenant(ctx, async (db) => {
    const rows = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, ctx.tenantId), eq(schema.appUser.email, email)));
    return rows[0]?.id ?? null;
  });
}

// --- Connector/Tool/Capability-group demo seed data (BL-02, BL-03; Design Studio's ---
// Phase 10 capability-group picker, LLD §3.5/§3.6) ---------------------------------
//
// Every tool row below is inserted DIRECTLY against `schema.tool`/`schema.connector`
// (never through `discoverAndSyncTools`/`@nextbot/connectors`' `discoverTools`) —
// there is no real, reachable MCP endpoint for any of these four at seed time (no
// live local stdio process, no real Azure DevOps org, no real M365 tenant), the same
// reasoning that made Phase 1's `model_provider`/`model_route` seed above call the
// public application-service handlers directly rather than performing a live provider
// handshake. Both `connector.status` and `tool.circuit_state` are left at their DB
// defaults (`Offline`/`Closed`) — LLD §3.5/§3.6 both document these as
// "computed by the health/circuit-breaker subsystem only", i.e. exactly the
// "configured but not yet health-checked" state a freshly-registered, never-probed
// connector is actually in.
//
// `authMethod: "None"` on all four is a deliberate seed-data simplification, not a
// claim about these services' real auth requirements — Azure DevOps and Microsoft
// 365 both genuinely require OAuth2 in production. Modeling a real OAuth2 credential
// here would mean either fabricating a fake-but-encrypted `credential` row (nothing
// downstream would ever validate it, since no live discovery/call ever hits these
// connectors) or wiring this script into `@nextbot/secrets`' KMS envelope-encryption
// path purely for placeholder data — neither buys anything for a Tool
// Catalog/Design-Studio demo, and `authMethod: "None"` is the one value the
// `connector_credential_required_unless_none` DB check accepts with no credential
// row at all, keeping this seed idempotent and dependency-free.
type SeedToolDef = {
  name: string;
  description: string;
  /** JSON-Schema-ish input shape, matching each tool's real documented parameters as
   * closely as this dispatch's research supports (see per-connector comments below
   * for sources). Loosely typed (`Record<string, unknown>`), same as
   * `UpsertToolInput.inputSchema`'s own `object` type. */
  inputSchema: Record<string, unknown>;
  capabilityGroup: string;
};

type SeedConnectorDef = {
  name: string;
  description: string;
  backendType: BackendTypeValue;
  transport: McpTransportValue;
  authMethod: ConnectorAuthMethodValue;
  endpointUrl?: string;
  stdioCommand?: StdioCommand;
  tools: SeedToolDef[];
};

const CAPABILITY_GROUPS: Array<{ name: string; guidanceText: string; priorityWeight: number }> = [
  {
    name: "Knowledge & Web",
    guidanceText: "Persistent knowledge-graph memory and live web/page retrieval — use to recall prior context or look up current information the model doesn't already know.",
    priorityWeight: 60,
  },
  {
    name: "DevOps & Code",
    guidanceText: "Azure DevOps project, work-item, repository, pipeline, and wiki operations — use for engineering-facing agents (e.g. an internal developer-support assistant), not customer-facing support flows.",
    priorityWeight: 50,
  },
  {
    name: "Productivity & Collaboration",
    guidanceText: "Microsoft 365 mailbox, calendar, OneDrive/SharePoint file, Teams messaging, and Office document operations — use for agents that act on behalf of an employee's own M365 identity.",
    priorityWeight: 50,
  },
];

const SEED_CONNECTORS: SeedConnectorDef[] = [
  {
    // Source: github.com/modelcontextprotocol/servers, `src/memory` — the official
    // reference "Knowledge Graph Memory Server" (npm package
    // `@modelcontextprotocol/server-memory`). It is a local, stdio-transport MCP
    // server (no remote/HTTP mode is published) — modeled here as `StdioViaGateway`
    // with the exact `npx` invocation its own README documents, not forced into an
    // HTTP shape it doesn't actually have.
    name: "Memory",
    description: "Official MCP reference server for persistent knowledge-graph memory (entities, relations, observations) that survives across conversations.",
    backendType: "KnowledgeBase",
    transport: "StdioViaGateway",
    authMethod: "None",
    stdioCommand: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: {} },
    tools: [
      { name: "create_entities", description: "Create multiple new entities in the knowledge graph.", inputSchema: { type: "object", properties: { entities: { type: "array" } }, required: ["entities"] }, capabilityGroup: "Knowledge & Web" },
      { name: "create_relations", description: "Create multiple new relations between existing entities.", inputSchema: { type: "object", properties: { relations: { type: "array" } }, required: ["relations"] }, capabilityGroup: "Knowledge & Web" },
      { name: "add_observations", description: "Add new observations to existing entities.", inputSchema: { type: "object", properties: { observations: { type: "array" } }, required: ["observations"] }, capabilityGroup: "Knowledge & Web" },
      { name: "delete_entities", description: "Remove entities and their associated relations (cascading).", inputSchema: { type: "object", properties: { entityNames: { type: "array" } }, required: ["entityNames"] }, capabilityGroup: "Knowledge & Web" },
      { name: "delete_observations", description: "Remove specific observations from existing entities.", inputSchema: { type: "object", properties: { deletions: { type: "array" } }, required: ["deletions"] }, capabilityGroup: "Knowledge & Web" },
      { name: "read_graph", description: "Read the entire knowledge graph and return its complete structure.", inputSchema: { type: "object", properties: {} }, capabilityGroup: "Knowledge & Web" },
      { name: "search_nodes", description: "Search for nodes across entity names, types, and observations by query.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, capabilityGroup: "Knowledge & Web" },
      { name: "open_nodes", description: "Retrieve specific named nodes, along with the relations between them.", inputSchema: { type: "object", properties: { names: { type: "array" } }, required: ["names"] }, capabilityGroup: "Knowledge & Web" },
    ],
  },
  {
    // Source: github.com/modelcontextprotocol/servers, `src/fetch` — the official
    // reference "Fetch" server (PyPI package `mcp-server-fetch`, run via `uvx`).
    // Also local/stdio-only, like Memory above. It genuinely exposes only ONE tool
    // (plus a same-named MCP *prompt*, which isn't a `tool` row) — seeded faithfully
    // as a single tool rather than padded with invented ones.
    name: "Fetch / Web",
    description: "Official MCP reference server for retrieving a web page's contents (converted to markdown) for the model to read.",
    backendType: "Custom",
    transport: "StdioViaGateway",
    authMethod: "None",
    stdioCommand: { command: "uvx", args: ["mcp-server-fetch"], env: {} },
    tools: [
      {
        name: "fetch",
        description: "Fetches a URL from the internet and extracts its contents as markdown.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            max_length: { type: "integer" },
            start_index: { type: "integer" },
            raw: { type: "boolean" },
          },
          required: ["url"],
        },
        capabilityGroup: "Knowledge & Web",
      },
    ],
  },
  {
    // Source: github.com/microsoft/azure-devops-mcp (Microsoft's official Azure
    // DevOps MCP server) — `docs/TOOLSET.md`'s real tool table, remote-server section
    // documenting `https://mcp.dev.azure.com/{organization}` as the hosted endpoint
    // shape. `{organization}` below is a clearly-fake placeholder ("contoso-demo") —
    // no such Azure DevOps organization exists; a real deployment substitutes its own.
    // A representative 9 of this server's ~30+ real tools are seeded here (per
    // dispatch instructions, a handful covering the main domains, not every tool).
    // Several of these tools bundle multiple actions behind one MCP tool name via an
    // `action`-shaped parameter (e.g. `wit_work_item` covers get/list/query) — that is
    // this server's actual current tool-naming convention, not a simplification made
    // here.
    name: "Azure DevOps",
    description: "Microsoft's official Azure DevOps MCP server — projects, work items, repositories, pull requests, pipelines, wikis, and test plans.",
    backendType: "Custom",
    transport: "StreamableHTTP",
    authMethod: "None",
    endpointUrl: "https://mcp.dev.azure.com/contoso-demo",
    tools: [
      { name: "mcp_ado_core_list_projects", description: "List all projects in the organization.", inputSchema: { type: "object", properties: {} }, capabilityGroup: "DevOps & Code" },
      { name: "wit_work_item", description: "Get, batch-get, list comments/revisions for, or list work items for an iteration.", inputSchema: { type: "object", properties: { action: { type: "string" }, id: { type: "integer" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "wit_work_item_write", description: "Create, update, batch-update a work item, or add a child work item.", inputSchema: { type: "object", properties: { action: { type: "string" }, fields: { type: "object" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "wit_query", description: "Run a saved query or an ad-hoc WIQL query against work items.", inputSchema: { type: "object", properties: { action: { type: "string" }, wiql: { type: "string" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "repo_repository", description: "Get or list Git repositories in a project.", inputSchema: { type: "object", properties: { action: { type: "string" }, project: { type: "string" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "repo_pull_request", description: "Get, list, or list-by-commit pull requests.", inputSchema: { type: "object", properties: { action: { type: "string" }, repositoryId: { type: "string" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "pipelines_build", description: "List builds, get a build's status, or get its changes.", inputSchema: { type: "object", properties: { action: { type: "string" }, buildId: { type: "integer" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "pipelines_run", description: "Get a pipeline run, or list runs for a pipeline definition.", inputSchema: { type: "object", properties: { action: { type: "string" }, pipelineId: { type: "integer" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
      { name: "wiki", description: "List wikis/pages, or get a wiki page and its content.", inputSchema: { type: "object", properties: { action: { type: "string" }, wikiId: { type: "string" } }, required: ["action"] }, capabilityGroup: "DevOps & Code" },
    ],
  },
  {
    // Microsoft has not published one single, fixed MCP tool manifest for Microsoft
    // 365 the way it has for Azure DevOps — the actual tool set an M365/Graph-backed
    // MCP surface exposes is provider/version-dependent (it varies by which Graph
    // connectors/Copilot extensibility surface a given deployment wires up). The 9
    // tools below are a REPRESENTATIVE, illustrative set — not a literal scrape of one
    // fixed manifest — chosen to cover Outlook/Email, Calendar, OneDrive, SharePoint,
    // Teams, Excel, and Word, sourced from Microsoft Graph's well-documented public
    // REST surface for each of those products (`/me/messages`, `/me/events`,
    // `/me/drive`, `/sites`, `/teams/{id}/channels/{id}/messages`, workbook
    // range/worksheet operations, and document content extraction). `endpointUrl`
    // below is similarly illustrative (Graph-backed, remote/HTTP), not a documented
    // fixed Microsoft MCP hostname.
    name: "Microsoft 365",
    description: "Illustrative Microsoft 365/Graph-backed MCP surface — Outlook/Email, Calendar, OneDrive, SharePoint, Teams, Excel, and Word, representative of Microsoft's public Graph API capabilities for these products.",
    backendType: "Custom",
    transport: "StreamableHTTP",
    authMethod: "None",
    endpointUrl: "https://graph.microsoft.com/v1.0/mcp",
    tools: [
      { name: "list_messages", description: "List messages in a mailbox folder (Outlook/Email).", inputSchema: { type: "object", properties: { folder: { type: "string" }, top: { type: "integer" } } }, capabilityGroup: "Productivity & Collaboration" },
      { name: "send_message", description: "Send an email message on behalf of the signed-in user.", inputSchema: { type: "object", properties: { to: { type: "array" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] }, capabilityGroup: "Productivity & Collaboration" },
      { name: "list_calendar_events", description: "List upcoming events on the user's calendar.", inputSchema: { type: "object", properties: { startDateTime: { type: "string" }, endDateTime: { type: "string" } } }, capabilityGroup: "Productivity & Collaboration" },
      { name: "list_onedrive_files", description: "List files and folders in a OneDrive folder.", inputSchema: { type: "object", properties: { folderPath: { type: "string" } } }, capabilityGroup: "Productivity & Collaboration" },
      { name: "get_onedrive_file_content", description: "Download a OneDrive file's content by item id or path.", inputSchema: { type: "object", properties: { itemId: { type: "string" } }, required: ["itemId"] }, capabilityGroup: "Productivity & Collaboration" },
      { name: "search_sharepoint_sites", description: "Search SharePoint sites and document libraries by keyword.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, capabilityGroup: "Productivity & Collaboration" },
      { name: "send_teams_message", description: "Post a message to a Microsoft Teams channel.", inputSchema: { type: "object", properties: { teamId: { type: "string" }, channelId: { type: "string" }, content: { type: "string" } }, required: ["teamId", "channelId", "content"] }, capabilityGroup: "Productivity & Collaboration" },
      { name: "read_excel_range", description: "Read a cell range from a worksheet in an Excel workbook.", inputSchema: { type: "object", properties: { workbookId: { type: "string" }, worksheet: { type: "string" }, range: { type: "string" } }, required: ["workbookId", "worksheet", "range"] }, capabilityGroup: "Productivity & Collaboration" },
      { name: "get_word_document_text", description: "Extract the text content of a Word document.", inputSchema: { type: "object", properties: { documentId: { type: "string" } }, required: ["documentId"] }, capabilityGroup: "Productivity & Collaboration" },
    ],
  },
];

/** Idempotently ensures the demo `capability_group` rows exist (checked by name, this
 * table's own unique constraint), returning a `name -> id` map the connector/tool seed
 * below uses to assign each seeded tool's `capabilityGroupId`. */
async function seedCapabilityGroups(ctx: TenantContext): Promise<Map<string, string>> {
  const existing = await listCapabilityGroups(ctx);
  const idByName = new Map(existing.map((g) => [g.name, g.id] as const));
  for (const group of CAPABILITY_GROUPS) {
    if (idByName.has(group.name)) {
      console.log(`seed: capability group '${group.name}' already exists — skipping.`);
      continue;
    }
    const id = await createCapabilityGroup(ctx, { name: group.name, guidanceText: group.guidanceText, priorityWeight: group.priorityWeight });
    idByName.set(group.name, id);
    console.log(`seed: capability group '${group.name}' created (id=${id}).`);
  }
  return idByName;
}

/** Idempotently ensures the four demo connectors + their tools exist (checked by
 * `(tenantId, environment, name)` for connectors and `(tenantId, connectorId, name)`
 * for tools — both this schema's own real unique constraints). Inserts directly
 * against `schema.connector`/`schema.tool`/`schema.toolSchemaVersion` rather than
 * through `@nextbot/connectors`' `createConnector`/live discovery — see the doc
 * comment on `SEED_CONNECTORS` above for why. */
async function seedConnectorsAndTools(ctx: TenantContext, groupIdByName: Map<string, string>): Promise<void> {
  for (const def of SEED_CONNECTORS) {
    const existingConnector = await findConnectorByName(ctx, "Sandbox", def.name);
    let connectorId: string;
    if (existingConnector) {
      console.log(`seed: connector '${def.name}' already exists (id=${existingConnector.id}) — skipping connector creation.`);
      connectorId = existingConnector.id;
    } else {
      connectorId = generateId();
      await withTenant(ctx, async (db: TenantScopedClient) => {
        await db.insert(schema.connector).values({
          id: connectorId,
          tenantId: ctx.tenantId,
          name: def.name,
          description: def.description,
          backendType: def.backendType,
          transport: def.transport,
          endpointUrl: def.endpointUrl ?? null,
          stdioCommand: def.stdioCommand ?? null,
          authMethod: def.authMethod,
          credentialId: null,
          environment: "Sandbox",
        });
      });
      console.log(`seed: connector '${def.name}' created (id=${connectorId}, transport=${def.transport}).`);
    }

    for (const toolDef of def.tools) {
      const capabilityGroupId = groupIdByName.get(toolDef.capabilityGroup) ?? null;
      const existingToolRows = await withTenant(ctx, async (db: TenantScopedClient) =>
        db
          .select({ id: schema.tool.id })
          .from(schema.tool)
          .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.connectorId, connectorId), eq(schema.tool.name, toolDef.name))),
      );
      if (existingToolRows[0]) {
        console.log(`seed: tool '${def.name}/${toolDef.name}' already exists — skipping.`);
        continue;
      }

      const rwClass = classifyReadWrite(toolDef.name);
      const approvalTier = defaultApprovalTier(def.backendType, rwClass, toolDef.name);
      const toolId = generateId();
      const versionId = generateId();
      // Same mutual-FK insert dance `upsertToolFromDiscovery` uses (LLD §3.6): `tool`
      // is inserted with a NULL `currentSchemaVersionId`, `tool_schema_version` is
      // inserted referencing the now-existing `tool` row, then `tool` is updated to
      // point at it — all within one `withTenant` transaction.
      await withTenant(ctx, async (db: TenantScopedClient) => {
        await db.insert(schema.tool).values({
          id: toolId,
          tenantId: ctx.tenantId,
          connectorId,
          name: toolDef.name,
          descriptionSource: toolDef.description,
          currentSchemaVersionId: null,
          rwClass,
          rwClassSource: "AutoHeuristic",
          approvalTier,
          approvalTierSource: "BackendTypeDefault",
          capabilityGroupId,
        });
        await db.insert(schema.toolSchemaVersion).values({
          id: versionId,
          tenantId: ctx.tenantId,
          toolId,
          versionOrdinal: 1,
          inputSchema: toolDef.inputSchema,
          outputSchema: {},
          schemaHash: createHash("sha256").update(JSON.stringify({ inputSchema: toolDef.inputSchema, outputSchema: {} })).digest("hex"),
          breakingChange: false,
        });
        await db
          .update(schema.tool)
          .set({ currentSchemaVersionId: versionId })
          .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, toolId)));
      });
      console.log(`seed: tool '${def.name}/${toolDef.name}' created (id=${toolId}, tier=${approvalTier}, rwClass=${rwClass}).`);
    }
  }
}

async function main(): Promise<void> {
  let tenantId: string;
  const existing = await findExistingTenant();
  if (existing) {
    console.log(`seed: tenant '${TENANT_SLUG}' already exists (id=${existing.id}) — skipping provisioning.`);
    tenantId = existing.id;
  } else {
    const tenant = await provisionTenant({
      name: TENANT_NAME,
      slug: TENANT_SLUG,
      region: TENANT_REGION,
      planTier: TENANT_PLAN,
      defaultLanguage: DEFAULT_LANGUAGE,
      retention: {
        transcriptsDays: 365,
        toolPayloadsDays: 90,
        toolMetadataDays: 365,
        piiDays: 30,
      },
    });
    tenantId = tenant.id;
    console.log(`seed: provisioned tenant '${TENANT_SLUG}' (id=${tenantId}).`);
  }

  const ctx = { tenantId, region: TENANT_REGION, environment: "Sandbox" as const };
  await seedSystemRoles(ctx);
  console.log("seed: system roles ensured.");

  const created: Array<{ email: string; roleName: string }> = [];
  // Tracks every seeded user's real `app_user.id`, keyed by email, regardless of
  // whether this run created the row or it already existed — the agent-definition-
  // version seed below (Designer creates, Tenant Admin approves) needs two genuine,
  // distinct actor ids to honestly exercise `promotion-policy.ts`'s reviewer!=author
  // check, not placeholder/fixture ids.
  const userIdByEmail = new Map<string, string>();
  for (const u of SEED_USERS) {
    try {
      const userId = await registerUser(ctx, {
        email: u.email,
        password: DEMO_PASSWORD,
        displayName: u.displayName,
        roleName: u.roleName,
      });
      userIdByEmail.set(u.email, userId);
      created.push({ email: u.email, roleName: u.roleName });
      console.log(`seed: created user ${u.email} (${u.roleName}).`);
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        console.log(`seed: user ${u.email} already exists — skipping.`);
        const existingId = await findUserIdByEmail(ctx, u.email);
        if (existingId) userIdByEmail.set(u.email, existingId);
        continue;
      }
      throw err;
    }
  }

  // --- Model Gateway seed data (BL-07, ADR-0006, LLD §7.1) -----------------------
  // A tenant with zero `model_provider`/`model_route` rows makes `chat.primary`
  // silently fall back to `ai-registry`'s bare env default (see
  // `model-gateway-service.ts`'s own doc comment on that precedence) — invisible and
  // uneditable from the Model Gateway console. Registering one platform provider and
  // one tenant route here makes that resolution visible from first boot. Both calls
  // go through the same public application-service handlers the Admin Console's own
  // Model Gateway screens call (`handleRegisterModelProvider`/`handleUpsertModelRoute`
  // — see `packages/modules/agent-platform/src/index.ts`), and both are already
  // idempotent upserts (`registerModelProvider` upserts by `key`; `upsertModelRoute`
  // upserts by `(tenantId, routeKey)`), so re-running this on every `docker compose
  // up` is safe without an extra existence check here.
  //
  // The provider's `baseUrl`/model name mirror this stack's own `AI_BASE_URL`/
  // `AI_MODEL_CHAT_PRIMARY` env defaults (docker-compose.yml's `x-shared-env`
  // anchor — an OpenAI-compatible endpoint at `host.docker.internal:11434/v1`,
  // i.e. a locally-run Ollama, when nothing else is configured) rather than an
  // invented value disconnected from whatever AI backend this deployment actually
  // has reachable.
  const MODEL_PROVIDER_KEY = "openai-compatible" as const;
  const modelBaseUrl = process.env.AI_BASE_URL || "http://host.docker.internal:11434/v1";
  const modelName = process.env.AI_MODEL_CHAT_PRIMARY || "local-placeholder-model";

  // Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.9.6):
  // `registerModelProvider` moved to `@nextbot/model-gateway` and now always upserts a
  // TENANT-owned row (`tenant_id = ctx.tenantId`) rather than a platform-wide one —
  // writing a `tenant_id IS NULL` row needs `withPlatform()`, restricted to tenancy
  // provisioning / `/api/internal/ops/**` (LLD §3.2 rule 4), which this seed script's
  // existing call path isn't. This is a deliberate, flagged narrowing (this script
  // seeds exactly one tenant, so "platform-shared" vs. "this tenant's own" makes no
  // observable difference to `chat.primary`'s resolution) — see that module's own doc
  // comment on `registerModelProvider` for the full rationale.
  const seededProvider = await handleRegisterModelProvider(ctx, {
    key: MODEL_PROVIDER_KEY,
    label: "OpenAI-compatible (local/self-hosted)",
    baseUrl: modelBaseUrl,
    regions: [],
    enabled: true,
  });
  console.log(`seed: model provider '${MODEL_PROVIDER_KEY}' registered (baseUrl=${modelBaseUrl}).`);

  // Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8, FR-AGT-20-22): Route v2
  // pins a real `model_catalog_entry`, never a free-text model string — declare one
  // manually for the seeded provider (conservative capabilities; a real deployment
  // would sync/declare its actual model's capabilities via the console), then create
  // `chat.primary` as a real, Published `model_route`/`model_route_version`. This is
  // idempotent-by-inspection (re-running `db:seed` against an already-seeded tenant
  // finds the existing 'chat.primary' route via `existingRoutes.length > 0` below and
  // skips re-creating it, mirroring `agent_definition`'s own idempotency guard further
  // down this script — a route has no natural "re-register the same one" upsert
  // semantics the way `model_provider` does).
  const seededCatalogEntry = await declareCatalogEntry(ctx, {
    providerId: seededProvider.id,
    modelId: modelName,
    displayName: modelName,
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
  }).catch(async () => {
    // Already declared by a previous run (UNIQUE (provider_id, model_id)) — read it
    // back rather than fail the whole seed run.
    const rows = await withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelCatalogEntry).where(and(eq(schema.modelCatalogEntry.providerId, seededProvider.id), eq(schema.modelCatalogEntry.modelId, modelName))));
    return rows[0]!;
  });

  const existingRoutes = await withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelRoute).where(and(eq(schema.modelRoute.tenantId, ctx.tenantId), eq(schema.modelRoute.name, "chat.primary"))));
  if (existingRoutes.length === 0) {
    const route = await createRoute(ctx, { name: "chat.primary", role: "chat.primary" });
    await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: seededProvider.id, catalogEntryId: seededCatalogEntry.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
      },
      true,
    );
    console.log(`seed: model route 'chat.primary' created (provider=${MODEL_PROVIDER_KEY}, model=${modelName}).`);
  } else {
    console.log(`seed: model route 'chat.primary' already exists — skipping.`);
  }

  // --- Tool Registry seed data: connectors, tools, capability groups (BL-02/BL-03, ---
  // LLD §3.5/§3.6) -----------------------------------------------------------------
  const capabilityGroupIdByName = await seedCapabilityGroups(ctx);
  await seedConnectorsAndTools(ctx, capabilityGroupIdByName);

  // --- Agent Definition + Version + Production promotion seed data (BL-07, LLD -----
  // §3.10/§7.3) -------------------------------------------------------------------
  // Definition creation is guarded on "this tenant doesn't already have an
  // agent_definition" (per this dispatch's explicit idempotency requirement) rather
  // than upserting, since `agent_definition` has no natural "re-register the same
  // one" semantics the way `model_provider`/`model_route` do above — a second run
  // must not attempt to recreate a name-duplicate definition.
  const SUPPORT_ASSISTANT_DESCRIPTION =
    "First-line customer support agent for common account, billing, and product questions — hands off to a human via the escalation policy below Guardrails' confidence threshold.";
  const existingDefinitions = await handleListDefinitions(ctx);
  let definitionId: string;
  if (existingDefinitions.length > 0) {
    definitionId = existingDefinitions[0]!.id;
    console.log(`seed: tenant '${TENANT_SLUG}' already has ${existingDefinitions.length} agent definition(s) (id=${definitionId}) — skipping definition creation.`);
  } else {
    const definition = await handleCreateDefinition(ctx, {
      name: "Support Assistant",
      description: SUPPORT_ASSISTANT_DESCRIPTION,
    });
    definitionId = definition.id;
    console.log(`seed: agent definition '${definition.name}' created (id=${definition.id}).`);
  }

  // Version creation/promotion is separately guarded on "this definition doesn't
  // already have a version" (per this dispatch's explicit idempotency requirement),
  // independent of the definition-creation guard above — a prior run that created the
  // definition but failed before finishing the version/promotion walk (e.g. the
  // configured model backend was briefly unreachable, see the catch block below) must
  // still complete this step on the next run instead of being permanently skipped.
  //
  // ADR-0009's 2026-08-23 amendment (Phase 5 of this same client-feedback batch,
  // `docs/plans/client-feedback-batch-plan.md`) removed the hard Git-connection
  // requirement `createAgentDefinitionVersion` used to enforce — Phase 1 of this batch
  // had left this step undone for exactly that reason. This tenant has no Git
  // connection configured (no `connectGit()` call anywhere in this script), so the
  // version below is created with `gitCommitSha: null` and promoted entirely via the
  // in-app reviewer!=author mechanism (`promotion-policy.ts`'s `Approved` case) —
  // never a hand-written status, and never a Git commit faked to satisfy ADR-0009's
  // original (now-amended) requirement.
  const [definitionSummary] = (await handleListDefinitions(ctx)).filter((d) => d.id === definitionId);
  const designerUserId = userIdByEmail.get("designer@demo.nextbot.local") ?? null;
  const tenantAdminUserId = userIdByEmail.get("admin@demo.nextbot.local") ?? null;

  if (definitionSummary && definitionSummary.versionCount > 0) {
    console.log(
      `seed: agent definition '${definitionSummary.name}' already has ${definitionSummary.versionCount} version(s) ` +
        `(production=${definitionSummary.productionVersion ?? "none"}) — skipping version creation/promotion.`,
    );
  } else if (!designerUserId || !tenantAdminUserId) {
    // Should not happen (both are unconditionally seeded above) unless the user-
    // seeding loop above hit an unexpected state; fail loudly rather than silently
    // skipping, but don't abort the rest of the script (SEED_CREDENTIALS.md below
    // must still be written).
    console.error("seed: ERROR — could not resolve the seeded Designer/Tenant Admin user ids; skipping agent_definition_version seed.");
  } else {
    try {
      // Real support-agent-shaped artifact (LLD §7.3) — the instructions/guardrails
      // link directly to the definition's own description above (0.6 confidence floor
      // matches "escalation policy below Guardrails' confidence threshold"), pointing
      // at the `chat.primary` route seeded earlier in this script. `CustomFSM` is one
      // of the two graph types this deployment actually has an adapter installed for
      // (ADR-0003/NFR-12 — see `promote-version-service.ts`'s `INSTALLED_GRAPH_TYPES`),
      // so the version can genuinely reach `Production` (the gate rejects an
      // uninstalled graph type there).
      const artifact = {
        apiVersion: "nextbot.io/v1" as const,
        kind: "AgentDefinition" as const,
        metadata: { name: "Support Assistant", version: "1.0.0" },
        spec: {
          graphType: "CustomFSM" as const,
          modelRoute: "chat.primary",
          instructions:
            "You are the Support Assistant, NextBot's first-line customer support agent. Answer common account, " +
            "billing, and product questions directly and concisely. If you are not confident in an answer, or the " +
            "customer asks for a human, say so plainly and hand off — do not guess.",
          // References the "Knowledge & Web" capability group seeded above (Memory +
          // Fetch tools) by name — resolved to real capability_group.id(s) at turn-
          // pipeline time via `resolveCapabilityGroupIdsByNames` (a stale/renamed name
          // simply contributes nothing, per that function's own contract), so this is
          // a safe, purely-additive reference rather than a hard dependency.
          toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: ["Knowledge & Web"], maxToolCallsPerTurn: 5 },
          guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: ["low-confidence-response", "customer-requested-human"] },
          memory: { strategy: "rolling-window", maxTurns: 20 },
          budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
        },
      };

      const version = await handleCreateVersion(
        ctx,
        definitionId,
        { version: "1.0.0", graphType: "CustomFSM", modelRouteKey: "chat.primary", artifact },
        designerUserId,
      );
      console.log(`seed: agent definition version '${version.version}' created (id=${version.id}, gitCommitSha=${version.gitCommitSha ?? "null (no Git connection)"}).`);

      // A minimal but real eval suite/case — `EvalGated -> HumanReview` requires a
      // `Passed` run against this exact version's `definitionHash` (LLD §3.10 /
      // `promotion-policy.ts`'s `HumanReview` case). `expectedResponsePattern: ".*"`
      // (same convention `promote-version-service.int.test.ts` uses) asserts only that
      // the configured `chat.primary` model backend answered at all — this script
      // cannot assume any specific wording from whatever real/local model a given
      // deployment has configured.
      const suite = await handleCreateEvalSuite(ctx, { name: "Support Assistant — smoke suite" });
      await handleAddEvalCase(ctx, suite.id, {
        name: "Handles a routine billing question",
        inputTranscript: [{ sender: "Customer", text: "Hi, I have a question about my last invoice." }],
        expectedResponsePattern: ".*",
      });
      await handleBindEvalSuite(ctx, version.id, suite.id);
      console.log(`seed: eval suite '${suite.name}' created and bound to version '${version.version}'.`);

      // Walks the real LLD §3.10 state machine end to end — every transition below
      // goes through `promoteAgentVersion`'s actual `canPromote()` gate (never a direct
      // status write): Draft -> EvalGated -> (real eval run) -> HumanReview -> Approved
      // (by a different user than the creator) -> Production (creates the real active
      // Deployment row the gate itself requires).
      await handlePromoteVersion(ctx, version.id, "EvalGated", designerUserId);
      await handleRunEvalSuite(ctx, version.id, "VersionSubmitted");
      await handlePromoteVersion(ctx, version.id, "HumanReview", designerUserId);
      await handlePromoteVersion(ctx, version.id, "Approved", tenantAdminUserId);
      // Phase 7 (client-feedback-batch item 6): Approved -> Production now also
      // requires a real, completed sandbox test against this exact version
      // (promotion-policy.ts). This seed script has no real widget/browser session
      // to drive a genuine end-to-end sandbox conversation through, so it calls the
      // same real, idempotent application-service function
      // (`recordSandboxTest`, `@nextbot/agent-platform`'s public API) that
      // `apps/gateway`'s turn-pipeline adapter itself calls once a real sandbox
      // turn completes — not a hand-written DB update — so demo data satisfies the
      // gate the same way a real operator's sandbox test would.
      await recordSandboxTest(ctx, version.id);
      await handlePromoteVersion(ctx, version.id, "Production", tenantAdminUserId);
      console.log(`seed: agent definition version '${version.version}' promoted all the way to Production.`);
    } catch (err) {
      // This step depends on a genuinely reachable `chat.primary` model backend (the
      // eval run above makes a real model call, per FR-AGT-06) — unlike the rest of
      // this script, that's an environmental dependency this seed script does not
      // control (mirrors the same AI_BASE_URL/Ollama dependency this stack's chat
      // features already have, per the model-gateway seed block above). Caught here,
      // not rethrown, so a transient/unavailable backend at seed time never prevents
      // the rest of this script (including writing SEED_CREDENTIALS.md below) from
      // completing — this step is safely retryable on the next `docker compose up`
      // (guarded on "no version yet" above), and it's a materially different failure
      // mode from Phase 1's ADR-0009 Git blocker, which no longer applies at all.
      console.error(
        "seed: WARNING — could not fully create/promote an agent_definition_version to Production. This most " +
          "commonly means the configured model backend (AI_BASE_URL) was not reachable at seed time — it is no " +
          "longer the ADR-0009 Git-connection requirement Phase 1 hit (that requirement was removed). Re-run " +
          "`pnpm run db:seed` once the model backend is reachable.",
        err,
      );
    }
  }

  // Re-read the definition's summary one last time so SEED_CREDENTIALS.md always
  // reflects the database's actual current state (whether this run just promoted a
  // version to Production, found one already there from a prior run, or the attempt
  // above genuinely failed against an unreachable model backend) rather than assuming
  // the outcome of the block above.
  const [finalDefinitionSummary] = (await handleListDefinitions(ctx)).filter((d) => d.id === definitionId);
  const agentPlatformLines =
    finalDefinitionSummary?.productionVersion
      ? [
          `| Agent definition | \"Support Assistant\" — version \`${finalDefinitionSummary.productionVersion}\` is live in **Production** |`,
          "",
          "The seeded version reached Production the same way a real operator would: created",
          "as Draft, gated on a real (passing) eval run, reviewed in HumanReview, Approved by",
          "a different user than its creator (Designer created it, Tenant Admin approved it —",
          "the reviewer!=author check), then promoted to Production. No tenant Git connection",
          "was configured for this — ADR-0009's 2026-08-23 amendment makes that in-app",
          "reviewer!=author check the documented approval mechanism when there's no Git PR/MR",
          "to review instead. Ready to use with the shared chat-preview surface once that",
          "screen lands.",
          "",
        ]
      : [
          "| Agent definition | \"Support Assistant\" (no Production version yet — see below) |",
          "",
          "**Version/promotion attempt did not complete this run.** This is no longer the",
          "ADR-0009 Git-connection blocker Phase 1 of this batch hit (that requirement has",
          "since been removed) — the most likely cause is the configured model backend",
          "(`AI_BASE_URL`, e.g. a local Ollama) not being reachable at seed time, since",
          "promoting a version through `EvalGated` requires a real, passing eval run against",
          "it. Check this container's seed log for the exact error, then re-run",
          "`pnpm run db:seed` once the model backend is reachable — this step is safely",
          "retryable (it only runs while the definition has zero versions).",
          "",
        ];

  const lines = [
    "# NextBot local seed credentials",
    "",
    "Generated by `scripts/seed.ts` — safe to re-run (idempotent), values are stable",
    "across runs unless you change this file, and are for LOCAL/DEV USE ONLY.",
    "",
    `Tenant slug (used in the login form's \"Tenant\" field): **${TENANT_SLUG}**`,
    "",
    "| Role | Email | Password |",
    "|---|---|---|",
    ...SEED_USERS.map((u) => `| ${u.roleName} | ${u.email} | ${DEMO_PASSWORD} |`),
    "",
    "Admin Console: http://localhost:3000/login",
    "Widget test embed: http://localhost:8080/widget/index.html · loader: http://localhost:8080/loader/nextbot.js",
    "",
    "## Platform Manager console (NFR-11, cross-tenant operator surface)",
    "",
    "URL (same public-looking path whether allowed or not): http://localhost:3000/internal/ops/login",
    `Operator token: \`${process.env.NEXTBOT_OPS_OPERATOR_TOKEN || DEFAULT_OPS_OPERATOR_TOKEN}\``,
    "",
    "Only reachable from this compose stack's own `web-proxy` hop by default — see",
    "docs/deployment/DEPLOYMENT.md \"Testing the Platform Manager console locally\" if",
    "this 404s (it should not, out of the box, but the same page 404s indistinguishably",
    "for a wrong token/IP, by design).",
    "",
    "## Agent Platform (BL-07, ADR-0006/0009 — Agent Platform Architecture Console)",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Model provider | \`${MODEL_PROVIDER_KEY}\` — \"OpenAI-compatible (local/self-hosted)\", baseUrl \`${modelBaseUrl}\` |`,
    `| Model route | \`chat.primary\` -> \`${MODEL_PROVIDER_KEY}\` / \`${modelName}\` |`,
    ...agentPlatformLines,
  ];
  const outPath = path.join(process.cwd(), "SEED_CREDENTIALS.md");
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`seed: wrote ${outPath}`);
  console.log(lines.join("\n"));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed: failed:", err);
    process.exitCode = 1;
  });
