import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { and, eq } from "drizzle-orm";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { createCapabilityGroup } from "@nextbot/tool-registry";
import { insertConnector } from "@nextbot/connectors";
import { McpDraftNotFoundError } from "@nextbot/contracts";
import {
  createDraft,
  deleteEnrolmentDraft,
  getEnrolmentDraft,
  submitAuth,
  submitClassify,
  submitDiscover,
  submitDryRun,
  submitEnrol,
  submitGrouping,
  submitIdentify,
  submitPolicy,
  submitTransport,
} from "./enrolment-draft-service.js";
import { createServerFromWizard, getServer, listBindingsForVersion } from "../infrastructure/mcp-server-repository.js";
import { computeSchemaHash } from "../domain/manifest-hash.js";
import { reconcileServer } from "./reconciler.js";
import { mcpClientManifestFetchPort } from "./manifest-fetch-port.js";

const OWNER = "22222222-2222-2222-2222-222222222222";
const ACTOR = "33333333-3333-3333-3333-333333333333";

const createdTenantIds: string[] = [];
const servers: MockMcpServerHandle[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  for (const s of servers.splice(0)) await s.close();
});

/** Walks the full 9-step wizard end to end against two REAL (mock) MCP servers — one
 * per environment — so a bug that accidentally shared a credential/endpoint between
 * environments would show up as a real cross-environment call, not a mocked
 * assertion. */
describe("MCP enrolment wizard (BL-34, LLD §14.3.4, all 9 steps against real HTTP servers)", () => {
  it("walks identify -> transport -> auth -> discover -> classify -> grouping -> policy -> dry-run -> enrol, producing a real, reconciler-compatible mcp_server", async () => {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const sandboxMock = await startMockMcpServer(
      [
        {
          name: "get_order",
          description: "Fetch an order by id",
          inputSchema: { type: "object", properties: { orderId: { type: "string" } } },
          result: { orderId: "SANDBOX-123", status: "shipped" },
        },
      ],
      {
        resources: [{ uri: "kb://order-faq", name: "Order FAQ", mimeType: "text/markdown" }],
        prompts: [{ name: "summarize_order", arguments: [{ name: "orderId", required: true }] }],
      },
    );
    servers.push(sandboxMock);
    const productionMock = await startMockMcpServer([
      {
        name: "get_order",
        description: "Fetch an order by id",
        inputSchema: { type: "object", properties: { orderId: { type: "string" } } },
        // Deliberately a DIFFERENT result than the sandbox server's — if the dry run
        // (or discovery) ever accidentally reached production, this distinct marker
        // would show up in the assertions below and the test would fail.
        result: { orderId: "PRODUCTION-should-never-be-called", status: "shipped" },
      },
    ]);
    servers.push(productionMock);

    const group = await createCapabilityGroup(ctx, { name: "Order Lookup" });

    // Step 0 — create the resumable draft.
    let draft = await createDraft(ctx, ACTOR);
    expect(draft.step).toBe(1);

    // Step 1 — identify.
    draft = await submitIdentify(ctx, draft.id, {
      name: "orders-mcp-wizard",
      description: "Order lookup MCP server",
      backendType: "Ticketing",
      ownerUserId: OWNER,
      criticality: "High",
    });
    expect(draft.step).toBe(2);

    // Step 2 — transport, one endpoint per environment.
    draft = await submitTransport(ctx, draft.id, {
      bindings: [
        { environment: "Sandbox", transport: "StreamableHTTP", endpointUrl: sandboxMock.url },
        { environment: "Production", transport: "StreamableHTTP", endpointUrl: productionMock.url },
      ],
    });
    expect(draft.step).toBe(3);

    // Step 3 — auth. Sandbox and Production get DIFFERENT credentials.
    draft = await submitAuth(ctx, draft.id, {
      bindings: [
        { environment: "Sandbox", authMethod: "APIKey", credentialPlaintext: "sandbox-secret-key" },
        { environment: "Production", authMethod: "APIKey", credentialPlaintext: "production-secret-key" },
      ],
    });
    expect(draft.step).toBe(4);
    const sandboxCredentialId = draft.payload.auth?.bindings.find((b) => b.environment === "Sandbox")?.credentialId;
    const productionCredentialId = draft.payload.auth?.bindings.find((b) => b.environment === "Production")?.credentialId;
    expect(sandboxCredentialId).toBeTruthy();
    expect(productionCredentialId).toBeTruthy();
    expect(sandboxCredentialId).not.toBe(productionCredentialId);
    // The draft's payload never carries the plaintext — only vault pointers.
    expect(JSON.stringify(draft.payload)).not.toContain("secret-key");

    // Step 4 — discovery handshake (always against Sandbox).
    const discovered = await submitDiscover(ctx, draft.id);
    draft = discovered.draft;
    expect(draft.step).toBe(5);
    expect(discovered.response.probedEnvironment).toBe("Sandbox");
    // Tool + Resource + Prompt — discovery covers all three MCP item kinds (BL-34's
    // addition over Phase 0's Tool-only discovery).
    expect(discovered.response.itemCount).toBe(3);
    const toolItem = discovered.response.items.find((i) => i.kind === "Tool" && i.name === "get_order");
    expect(toolItem?.suggestedIoClass).toBe("Read");
    expect(toolItem?.suggestedApprovalTier).toBe("Tier1");
    const resourceItem = discovered.response.items.find((i) => i.kind === "Resource" && i.name === "Order FAQ");
    const promptItem = discovered.response.items.find((i) => i.kind === "Prompt" && i.name === "summarize_order");
    // The heuristic only classifies Tool items — Resource/Prompt suggestions abstain (null).
    expect(resourceItem?.suggestedIoClass).toBeNull();
    expect(promptItem?.suggestedIoClass).toBeNull();

    // Step 5 — classification (confirms the heuristic's suggestion).
    draft = await submitClassify(ctx, draft.id, {
      items: [{ kind: "Tool", name: "get_order", ioClass: "Read", approvalTier: "Tier1", enabled: true }],
    });
    expect(draft.step).toBe(6);

    // Step 6 — grouping (single-valued, no bridge table).
    draft = await submitGrouping(ctx, draft.id, { items: [{ kind: "Tool", name: "get_order", capabilityGroupId: group }] });
    expect(draft.step).toBe(7);

    // Step 7 — runtime policy.
    draft = await submitPolicy(ctx, draft.id, {
      timeoutMs: 15000,
      retryMax: 1,
      retryBackoff: "linear",
      circuitErrorRatePct: 5,
      circuitOpenSeconds: 60,
      egressAllowlist: [],
    });
    expect(draft.step).toBe(8);

    // Step 8 — dry run. Must show the SANDBOX server's raw result, never production's.
    const dryRun = await submitDryRun(ctx, draft.id, { toolName: "get_order", environment: "Sandbox", args: { orderId: "abc" } });
    draft = dryRun.draft;
    expect(draft.step).toBe(9);
    expect(dryRun.response.environment).toBe("Sandbox");
    expect(dryRun.response.rawResult).toEqual({ orderId: "SANDBOX-123", status: "shipped" });
    expect(dryRun.response.ranAt).toBeTruthy();

    // `connector` enforces an https-only endpoint CHECK (FR-SEC-02 defense in depth —
    // real Sandbox/Production MCP endpoints are always https in production). This
    // test's mock server is a plain-HTTP loopback listener (there is no TLS-capable
    // in-process MCP fixture in this codebase — see `packages/testing/src/mcp-mock-
    // server.ts`), so discovery/dry-run above ran against it directly, but the
    // wizard is resumable/editable: an admin who tested discovery against a local
    // tunnel/staging endpoint pastes the real hosted https URL before finalizing.
    // Re-submitting step 2 here models exactly that, and re-exercises that a
    // resubmission after later steps have already run is accepted.
    draft = await submitTransport(ctx, draft.id, {
      bindings: [
        { environment: "Sandbox", transport: "StreamableHTTP", endpointUrl: "https://sandbox.orders-mcp.example.com/mcp" },
        { environment: "Production", transport: "StreamableHTTP", endpointUrl: "https://production.orders-mcp.example.com/mcp" },
      ],
    });

    // Step 9 — enrol.
    const enrolled = await submitEnrol(ctx, draft.id, ACTOR);
    expect(enrolled.version).toBe(1);
    expect(enrolled.manifestHash).toBe(discovered.response.manifestHash);
    expect(enrolled.bindings).toHaveLength(2);
    expect(enrolled.materialisedToolIds).toHaveLength(1);

    // The draft is consumed — re-fetching it now fails.
    await expect(getEnrolmentDraft(ctx, draft.id)).rejects.toThrow(McpDraftNotFoundError);

    // --- Real, persisted state assertions ---
    const server = await getServer(ctx, enrolled.serverId);
    expect(server?.name).toBe("orders-mcp-wizard");
    expect(server?.backendType).toBe("Ticketing");
    expect(server?.ownerUserId).toBe(OWNER);
    expect(server?.criticality).toBe("High");

    const bindings = await listBindingsForVersion(ctx, enrolled.serverVersionId);
    expect(bindings).toHaveLength(2);
    const sandboxBinding = bindings.find((b) => b.environment === "Sandbox")!;
    const productionBinding = bindings.find((b) => b.environment === "Production")!;
    // Sandbox and production own genuinely DIFFERENT connector rows and DIFFERENT
    // vaulted credentials — never the same row shared across environments.
    expect(sandboxBinding.connectorId).not.toBe(productionBinding.connectorId);
    expect(sandboxBinding.credentialId).toBe(sandboxCredentialId);
    expect(productionBinding.credentialId).toBe(productionCredentialId);

    // The connector rows themselves are real, distinct rows with the right endpoint
    // each.
    const sandboxConnector = await withTenant(ctx, (db) => db.select().from(schema.connector).where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, sandboxBinding.connectorId))).then((r) => r[0]));
    const productionConnector = await withTenant(ctx, (db) => db.select().from(schema.connector).where(and(eq(schema.connector.tenantId, ctx.tenantId), eq(schema.connector.id, productionBinding.connectorId))).then((r) => r[0]));
    expect(sandboxConnector?.endpointUrl).toBe("https://sandbox.orders-mcp.example.com/mcp");
    expect(productionConnector?.endpointUrl).toBe("https://production.orders-mcp.example.com/mcp");

    // The materialised `tool` row carries the wizard's classification/grouping, and
    // is attached to the PRODUCTION connector (highest-priority environment bound),
    // not sandbox — matching where an agent actually invokes it at runtime.
    const [toolRow] = await withTenant(ctx, (db) => db.select().from(schema.tool).where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.id, enrolled.materialisedToolIds[0]!))));
    expect(toolRow?.connectorId).toBe(productionBinding.connectorId);
    expect(toolRow?.rwClass).toBe("Read");
    expect(toolRow?.approvalTier).toBe("Tier1");
    expect(toolRow?.capabilityGroupId).toBe(group);

    // All 3 discovered items (Tool + Resource + Prompt) got a manifest item row;
    // the manifest item is linked back to the materialised tool row for the Tool one.
    const allManifestItems = await withTenant(ctx, (db) =>
      db.select().from(schema.mcpManifestItem).where(and(eq(schema.mcpManifestItem.tenantId, ctx.tenantId), eq(schema.mcpManifestItem.serverVersionId, enrolled.serverVersionId))),
    );
    expect(allManifestItems).toHaveLength(3);
    const toolManifestItem = allManifestItems.find((i) => i.kind === "Tool")!;
    expect(toolManifestItem.toolId).toBe(enrolled.materialisedToolIds[0]);
    expect(toolManifestItem.ioClass).toBe("Read");
    expect(toolManifestItem.enabled).toBe(true);
    // Resource/Prompt items were never explicitly classified/grouped in this test —
    // ADR-0014's fail-closed default applies: Tier3, disabled, Write (conservative).
    const resourceManifestItem = allManifestItems.find((i) => i.kind === "Resource")!;
    expect(resourceManifestItem.enabled).toBe(false);
    expect(resourceManifestItem.approvalTier).toBe("Tier3");
    expect(resourceManifestItem.ioClass).toBe("Write");
    expect(resourceManifestItem.toolId).toBeNull();
  });

  /**
   * Reconciler compatibility (kept as its own test, not appended to the walk above):
   * the previous test finalizes with placeholder https endpoints (the `connector`
   * table's real, security-motivated https-only CHECK — FR-SEC-02 — a plain-HTTP
   * loopback mock can never satisfy), so it can't itself re-invoke a live reconcile
   * against those unreachable placeholder URLs. This test instead drives the same
   * `createServerFromWizard` repository function the wizard's enrol step calls,
   * independently supplying the `connector` row's own (placeholder-https, to satisfy
   * its CHECK) endpoint and the environment binding's *real* dialable mock endpoint —
   * `mcp_server.endpointUrl`, which is what the reconciler actually calls (LLD §14.3.1:
   * `connector` is the health/runtime record, `mcp_server`/`mcp_environment_binding`
   * carry the manifest-pinning contract the reconciler compares against). This proves
   * the exit gate's requirement directly: a wizard-shaped `mcp_server_version`/
   * `mcp_manifest_item` reconciles byte-for-byte like Phase 0's own
   * `createServerWithApprovedVersion`-produced rows, and Phase 0's reconciler
   * (completely unmodified this phase) correctly detects drift against it.
   */
  it("Phase 0's reconciler (unmodified) correctly reconciles a wizard-created mcp_server_version and detects drift", async () => {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const mock = await startMockMcpServer([{ name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" } } } }]);
    servers.push(mock);

    const connectorId = await insertConnector(ctx, {
      name: "reconciler-compat-wizard-server",
      backendType: "Ticketing",
      transport: "StreamableHTTP",
      endpointUrl: "https://reconciler-compat.example.com/mcp",
      authMethod: "None",
      credentialId: null,
      environment: "Sandbox",
    });

    const schemaHash = computeSchemaHash({ type: "object", properties: { orderId: { type: "string" } } });
    const created = await createServerFromWizard(ctx, {
      name: "reconciler-compat-wizard-server",
      description: null,
      backendType: "Ticketing",
      ownerUserId: OWNER,
      criticality: "Medium",
      transport: "StreamableHTTP",
      authMethod: "None",
      policyJson: { timeoutMs: 15000, retryMax: 1, retryBackoff: "none", circuitErrorRatePct: 5, circuitOpenSeconds: 60, egressAllowlist: [] },
      items: [
        {
          kind: "Tool",
          name: "get_order",
          descriptionSource: "Fetch an order",
          schemaJson: { type: "object", properties: { orderId: { type: "string" } } },
          schemaHash,
          ioClass: "Read",
          ioClassSource: "AutoHeuristic",
          approvalTier: "Tier1",
          approvalTierSource: "AdminOverride",
          enabled: true,
          capabilityGroupId: null,
          knowledgeIngestionCandidate: false,
          toolId: null,
        },
      ],
      bindings: [
        {
          environment: "Sandbox",
          // The REAL dialable mock endpoint — this is what ends up on
          // `mcp_server.endpointUrl`, the column Phase 0's reconciler actually reads.
          endpointUrl: mock.url,
          stdioCommand: null,
          gatewayAgentId: null,
          credentialId: null,
          connectorId,
          reachability: "Unknown",
        },
      ],
      createdByUserId: ACTOR,
    });

    const noChangeResult = await reconcileServer(ctx, (await getServer(ctx, created.serverId))!, mcpClientManifestFetchPort);
    expect(noChangeResult.outcome).toBe("NoChange");

    mock.setTools([
      { name: "get_order", inputSchema: { type: "object", properties: { orderId: { type: "string" }, includeHistory: { type: "boolean" } } } },
    ]);
    const driftResult = await reconcileServer(ctx, (await getServer(ctx, created.serverId))!, mcpClientManifestFetchPort);
    expect(driftResult.outcome).toBe("DriftDetected");
    expect(driftResult.driftEventsInserted).toBe(1);

    const events = await withTenant(ctx, (db) => db.select().from(schema.mcpDriftEvent).where(and(eq(schema.mcpDriftEvent.tenantId, ctx.tenantId), eq(schema.mcpDriftEvent.serverId, created.serverId))));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ changeKind: "SchemaChanged", itemName: "get_order" });
  });

  it("unclassified items default to Tier3/disabled at enrol (fail-closed, ADR-0014 §2.2's rule applied to the wizard)", async () => {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const mock = await startMockMcpServer([{ name: "delete_account", inputSchema: { type: "object" } }]);
    servers.push(mock);

    let draft = await createDraft(ctx, ACTOR);
    draft = await submitIdentify(ctx, draft.id, { name: "unclassified-wizard-server", backendType: "Custom", ownerUserId: OWNER, criticality: "Medium" });
    draft = await submitTransport(ctx, draft.id, { bindings: [{ environment: "Sandbox", transport: "StreamableHTTP", endpointUrl: mock.url }] });
    draft = await submitAuth(ctx, draft.id, { bindings: [{ environment: "Sandbox", authMethod: "None" }] });
    const discovered = await submitDiscover(ctx, draft.id);
    draft = discovered.draft;
    // Deliberately skip classify/grouping for this item — go straight to policy.
    draft = await submitPolicy(ctx, draft.id, { timeoutMs: 15000, retryMax: 1, retryBackoff: "none", circuitErrorRatePct: 5, circuitOpenSeconds: 60, egressAllowlist: [] });
    // The dry-run step requires a classified, enabled Read tool — `delete_account`
    // is neither, so this must reject rather than silently invoking a write tool.
    await expect(submitDryRun(ctx, draft.id, { toolName: "delete_account", environment: "Sandbox" })).rejects.toThrow();

    // Enrol is blocked until the dry run has actually run (LLD §14.3.4: a client
    // cannot skip a step by calling enrol early).
    await expect(submitEnrol(ctx, draft.id, ACTOR)).rejects.toThrow();

    await deleteEnrolmentDraft(ctx, draft.id);
  });

  it("dry run surfaces a real transport failure as McpDiscoveryFailedError, not a generic 500", async () => {
    const ctx: TenantContext = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const mock = await startMockMcpServer([{ name: "get_order", inputSchema: { type: "object" }, result: { ok: true } }]);
    servers.push(mock);

    let draft = await createDraft(ctx, ACTOR);
    draft = await submitIdentify(ctx, draft.id, { name: "transport-failure-wizard-server", backendType: "Custom", ownerUserId: OWNER, criticality: "Low" });
    draft = await submitTransport(ctx, draft.id, { bindings: [{ environment: "Sandbox", transport: "StreamableHTTP", endpointUrl: mock.url }] });
    draft = await submitAuth(ctx, draft.id, { bindings: [{ environment: "Sandbox", authMethod: "None" }] });
    const discovered = await submitDiscover(ctx, draft.id);
    draft = discovered.draft;
    draft = await submitClassify(ctx, draft.id, { items: [{ kind: "Tool", name: "get_order", ioClass: "Read", approvalTier: "Tier1", enabled: true }] });
    draft = await submitPolicy(ctx, draft.id, { timeoutMs: 15000, retryMax: 1, retryBackoff: "none", circuitErrorRatePct: 5, circuitOpenSeconds: 60, egressAllowlist: [] });

    // The real mock server is closed before the dry run — the call genuinely fails
    // at the transport layer, and the wizard maps it to a real, user-facing error.
    await mock.close();
    servers.splice(servers.indexOf(mock), 1);

    await expect(submitDryRun(ctx, draft.id, { toolName: "get_order", environment: "Sandbox" })).rejects.toThrow(/discovery failed/i);

    await deleteEnrolmentDraft(ctx, draft.id);
  });
});
