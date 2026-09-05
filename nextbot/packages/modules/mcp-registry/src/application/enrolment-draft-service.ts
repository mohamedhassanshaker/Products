import { randomUUID } from "node:crypto";
import type { TenantContext } from "@nextbot/db";
import {
  McpBindingRequiredError,
  McpDiscoveryFailedError,
  McpDraftNotFoundError,
  McpDryRunRequiresReadToolError,
  McpServerNameDuplicateError,
  McpWizardStepOutOfOrderError,
  CredentialRequiredError,
  type ApprovalTierValue,
  type BackendTypeValue,
  type ConnectorAuthMethodValue,
  type McpAuthRequest,
  type McpClassifyRequest,
  type McpCriticalityValue,
  type McpDiscoverResponse,
  type McpDiscoveredItem,
  type McpDryRunRequest,
  type McpDryRunResponse,
  type McpEnrolResponse,
  type McpGroupingRequest,
  type McpIdentifyRequest,
  type McpRuntimePolicy,
  type McpTransportRequest,
  type RwClassValue,
  type CredentialTypeValue,
} from "@nextbot/contracts";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { getCredentialForDecrypt, insertConnector, insertCredential } from "@nextbot/connectors";
import { classifyReadWrite, defaultApprovalTier, setToolCapabilityGroup, upsertToolFromDiscovery } from "@nextbot/tool-registry";
import { callTool, listPrompts, listResources, listTools, McpTransportError } from "@nextbot/mcp-client";
import { computeManifestHash, computeSchemaHash } from "../domain/manifest-hash.js";
import {
  createDraft as createDraftRow,
  deleteDraft,
  getDraft,
  patchDraft,
  type DiscoveredItemSnapshot,
  type DraftRow,
} from "../infrastructure/enrolment-draft-repository.js";
import {
  createServerFromWizard,
  findServerByName,
  linkManifestItemToTool,
  type WizardBindingInput,
  type WizardManifestItemInput,
} from "../infrastructure/mcp-server-repository.js";

let provider: KmsEnvelopeSecretsProvider | undefined;
function getProvider(): KmsEnvelopeSecretsProvider {
  if (!provider) provider = new KmsEnvelopeSecretsProvider();
  return provider;
}

/** Mirrors `@nextbot/connectors`' `create-connector.ts` mapping exactly (kept local —
 * not worth a cross-module export for six lines). */
function authMethodToCredentialType(authMethod: ConnectorAuthMethodValue): CredentialTypeValue {
  switch (authMethod) {
    case "OAuth2":
      return "OAuthToken";
    case "BearerToken":
      return "BearerToken";
    default:
      return "APIKey";
  }
}

async function requireDraft(ctx: TenantContext, id: string): Promise<DraftRow> {
  const draft = await getDraft(ctx, id);
  if (!draft) throw new McpDraftNotFoundError(id);
  return draft;
}

/** Resolves a binding's stored `credentialId` to an `Authorization: Bearer` header —
 * mirrors `@nextbot/connectors`'s `discover-tools.ts` decrypt pattern exactly (the
 * "gateway" DB role reads ciphertext, the "app" role never does). `null` (no
 * credential, `authMethod = 'None'`) resolves to no auth headers at all. */
async function resolveAuthHeaders(ctx: TenantContext, credentialId: string | null): Promise<Record<string, string>> {
  if (!credentialId) return {};
  const encrypted = await getCredentialForDecrypt(ctx, credentialId);
  if (!encrypted) return {};
  const plaintext = await getProvider().get(encrypted.ciphertext, encrypted.dekRef, {
    tenantId: ctx.tenantId,
    kind: "mcp-server-credential",
    id: credentialId,
  });
  return { authorization: `Bearer ${plaintext}` };
}

export async function createDraft(ctx: TenantContext, createdByUserId: string): Promise<DraftRow> {
  return createDraftRow(ctx, createdByUserId);
}

export async function getEnrolmentDraft(ctx: TenantContext, id: string): Promise<DraftRow> {
  return requireDraft(ctx, id);
}

export async function deleteEnrolmentDraft(ctx: TenantContext, id: string): Promise<void> {
  await requireDraft(ctx, id);
  await deleteDraft(ctx, id);
}

/** Step 1 — identify. */
export async function submitIdentify(ctx: TenantContext, id: string, input: McpIdentifyRequest): Promise<DraftRow> {
  await requireDraft(ctx, id);
  const existing = await findServerByName(ctx, input.name);
  if (existing) throw new McpServerNameDuplicateError(input.name);
  return patchDraft(
    ctx,
    id,
    { identify: { name: input.name, description: input.description ?? null, backendType: input.backendType, ownerUserId: input.ownerUserId, criticality: input.criticality } },
    2,
  );
}

/** Step 2 — transport and endpoint, one entry per environment (FR-MCP-19). */
export async function submitTransport(ctx: TenantContext, id: string, input: McpTransportRequest): Promise<DraftRow> {
  const draft = await requireDraft(ctx, id);
  if (!draft.payload.identify) throw new McpWizardStepOutOfOrderError(1, 2);
  return patchDraft(
    ctx,
    id,
    { transport: { bindings: input.bindings.map((b) => ({ environment: b.environment, transport: b.transport, endpointUrl: b.endpointUrl ?? null, stdioCommand: b.stdioCommand ?? null })) } },
    3,
  );
}

/**
 * Step 3 — authentication. Sandbox and Production credentials are captured and
 * vaulted **separately** (one `credential` row per environment binding, never
 * shared) — this is the mechanism FR-MCP-16 step 3 exists to guarantee, not merely a
 * naming convention: two bindings pointing at the same `credentialId` would mean
 * sandbox testing could authenticate against a live system.
 */
export async function submitAuth(ctx: TenantContext, id: string, input: McpAuthRequest): Promise<DraftRow> {
  const draft = await requireDraft(ctx, id);
  if (!draft.payload.transport) throw new McpWizardStepOutOfOrderError(2, 3);

  const bindings: Array<{ environment: string; authMethod: string; credentialId: string | null }> = [];
  for (const binding of input.bindings) {
    let credentialId: string | null = null;
    if (binding.authMethod !== "None") {
      if (!binding.credentialPlaintext) throw new CredentialRequiredError();
      const rowId = randomUUID();
      const encrypted = await getProvider().put(binding.credentialPlaintext, {
        tenantId: ctx.tenantId,
        kind: "mcp-server-credential",
        id: rowId,
      });
      credentialId = await insertCredential(ctx, {
        id: rowId,
        label: binding.credentialLabel ?? `${draft.payload.identify?.name ?? "MCP server"} (${binding.environment}) credential`,
        type: authMethodToCredentialType(binding.authMethod),
        vaultRef: encrypted.vaultRef,
        ciphertext: encrypted.ciphertext,
        dekRef: encrypted.dekRef,
        maskedHint: encrypted.maskedHint,
      });
    }
    bindings.push({ environment: binding.environment, authMethod: binding.authMethod, credentialId });
  }

  return patchDraft(ctx, id, { auth: { bindings } }, 4);
}

/**
 * Step 4 — discovery handshake. Connects to the **Sandbox** binding only (discovery
 * always probes sandbox — LLD §14.3.4's `McpDiscoverResponseSchema.probedEnvironment`
 * is always `Sandbox`), enumerates tools/resources/prompts, hashes each item's schema
 * (Phase 0's exact `computeSchemaHash`/`computeManifestHash` — never re-derived), and
 * pre-fills a Read/Write + approval-tier suggestion for `Tool` items via
 * `@nextbot/tool-registry`'s existing heuristic (`Resource`/`Prompt` items have no
 * read/write heuristic to apply — the suggestion is `null`, "heuristic abstained").
 */
export async function submitDiscover(ctx: TenantContext, id: string): Promise<{ draft: DraftRow; response: McpDiscoverResponse }> {
  const draft = await requireDraft(ctx, id);
  if (!draft.payload.transport || !draft.payload.auth) throw new McpWizardStepOutOfOrderError(3, 4);

  const sandboxTransport = draft.payload.transport.bindings.find((b) => b.environment === "Sandbox");
  if (!sandboxTransport?.endpointUrl) throw new McpBindingRequiredError();
  const sandboxAuth = draft.payload.auth.bindings.find((b) => b.environment === "Sandbox");
  const headers = await resolveAuthHeaders(ctx, sandboxAuth?.credentialId ?? null);
  const endpointUrl = sandboxTransport.endpointUrl;

  let tools, resources, prompts;
  try {
    [tools, resources, prompts] = await Promise.all([
      listTools({ endpointUrl, headers }),
      listResources({ endpointUrl, headers }),
      listPrompts({ endpointUrl, headers }),
    ]);
  } catch (err) {
    if (err instanceof McpTransportError) throw new McpDiscoveryFailedError(err.message);
    throw new McpDiscoveryFailedError(err instanceof Error ? err.message : String(err));
  }

  const backendType: BackendTypeValue = (draft.payload.identify?.backendType as BackendTypeValue) ?? "Custom";
  const snapshot: DiscoveredItemSnapshot[] = [];
  const items: McpDiscoveredItem[] = [];

  for (const t of tools) {
    const schemaHash = computeSchemaHash(t.inputSchema);
    snapshot.push({ kind: "Tool", name: t.name, descriptionSource: t.description ?? "", schemaJson: t.inputSchema, schemaHash });
    const ioClass: RwClassValue = classifyReadWrite(t.name);
    const approvalTier: ApprovalTierValue = defaultApprovalTier(backendType, ioClass, t.name);
    items.push({
      kind: "Tool",
      name: t.name,
      descriptionSource: t.description ?? "",
      schemaHash,
      suggestedIoClass: ioClass,
      suggestedApprovalTier: approvalTier,
      heuristicReason: `Heuristic: classified '${ioClass}' from the tool name; '${approvalTier}' is the seeded default for ${backendType} ${ioClass} tools.`,
    });
  }
  for (const r of resources) {
    const schemaJson = { uri: r.uri, mimeType: r.mimeType ?? null };
    const schemaHash = computeSchemaHash(schemaJson);
    snapshot.push({ kind: "Resource", name: r.name, descriptionSource: r.description ?? "", schemaJson, schemaHash });
    items.push({ kind: "Resource", name: r.name, descriptionSource: r.description ?? "", schemaHash, suggestedIoClass: null, suggestedApprovalTier: null, heuristicReason: null });
  }
  for (const p of prompts) {
    const schemaJson = { arguments: p.arguments ?? [] };
    const schemaHash = computeSchemaHash(schemaJson);
    snapshot.push({ kind: "Prompt", name: p.name, descriptionSource: p.description ?? "", schemaJson, schemaHash });
    items.push({ kind: "Prompt", name: p.name, descriptionSource: p.description ?? "", schemaHash, suggestedIoClass: null, suggestedApprovalTier: null, heuristicReason: null });
  }

  const manifestHash = computeManifestHash(snapshot.map((i) => ({ kind: i.kind, name: i.name, schemaHash: i.schemaHash })));
  const response: McpDiscoverResponse = {
    manifestHash,
    itemCount: items.length,
    items,
    probedEnvironment: "Sandbox",
    ...(items.length === 0 ? { emptyNotice: "No tools discovered — this server currently has nothing to enrol" as const } : {}),
  };

  const updated = await patchDraft(ctx, id, { discover: { manifestHash, itemCount: items.length, probedEnvironment: "Sandbox" } }, 5, { discoverySnapshot: snapshot });
  return { draft: updated, response };
}

/** Step 5 — classification. A field omitted for an item is left un-set in the draft
 * (not defaulted here) — the fail-closed Tier3/disabled default is applied once,
 * authoritatively, at enrol (step 9), so a partial submission (an admin working
 * through the list) never silently locks in a premature default. */
export async function submitClassify(ctx: TenantContext, id: string, input: McpClassifyRequest): Promise<DraftRow> {
  const draft = await requireDraft(ctx, id);
  if (!draft.discoverySnapshot) throw new McpWizardStepOutOfOrderError(4, 5);
  const classify = { ...(draft.payload.classify ?? {}) };
  for (const item of input.items) {
    classify[`${item.kind}:${item.name}`] = {
      ioClass: item.ioClass,
      approvalTier: item.approvalTier,
      enabled: item.enabled,
      descriptionOverride: item.descriptionOverride,
      knowledgeIngestionCandidate: item.knowledgeIngestionCandidate,
    };
  }
  return patchDraft(ctx, id, { classify }, 6);
}

/** Step 6 — grouping. Single-valued per item (LLD §14.3.3 — no bridge table): staged
 * here exactly as it will be persisted on `mcp_manifest_item.capability_group_id`. */
export async function submitGrouping(ctx: TenantContext, id: string, input: McpGroupingRequest): Promise<DraftRow> {
  const draft = await requireDraft(ctx, id);
  if (!draft.discoverySnapshot) throw new McpWizardStepOutOfOrderError(4, 6);
  const grouping = { ...(draft.payload.grouping ?? {}) };
  for (const item of input.items) {
    grouping[`${item.kind}:${item.name}`] = { capabilityGroupId: item.capabilityGroupId };
  }
  return patchDraft(ctx, id, { grouping }, 7);
}

/** Step 7 — runtime policy. */
export async function submitPolicy(ctx: TenantContext, id: string, input: McpRuntimePolicy): Promise<DraftRow> {
  await requireDraft(ctx, id);
  return patchDraft(ctx, id, { policy: input }, 8);
}

/**
 * Step 8 — dry run. **Always** invoked against the Sandbox binding's credential,
 * regardless of what the caller's request otherwise implies (FR-MCP-16 step 8: "one
 * read-only tool against the sandbox credential") — there is no dry-run path that
 * ever reaches Production. Fails closed: the target must already be classified
 * `Read` and `enabled` in this draft's step-5 answers (or the heuristic default, if
 * the admin hasn't touched this specific item yet) — a write tool, or an
 * unclassified one, can never be the dry-run target.
 */
export async function submitDryRun(ctx: TenantContext, id: string, input: McpDryRunRequest): Promise<{ draft: DraftRow; response: McpDryRunResponse }> {
  const draft = await requireDraft(ctx, id);
  if (!draft.discoverySnapshot || !draft.payload.transport || !draft.payload.auth) throw new McpWizardStepOutOfOrderError(4, 8);

  const item = draft.discoverySnapshot.find((i) => i.kind === "Tool" && i.name === input.toolName);
  if (!item) throw new McpDryRunRequiresReadToolError(input.toolName);

  const classification = draft.payload.classify?.[`Tool:${input.toolName}`];
  const ioClass = classification?.ioClass ?? classifyReadWrite(input.toolName);
  const enabled = classification?.enabled ?? false;
  if (ioClass !== "Read" || !enabled) throw new McpDryRunRequiresReadToolError(input.toolName);

  const sandboxTransport = draft.payload.transport.bindings.find((b) => b.environment === "Sandbox");
  if (!sandboxTransport?.endpointUrl) throw new McpBindingRequiredError();
  const sandboxAuth = draft.payload.auth.bindings.find((b) => b.environment === "Sandbox");
  const headers = await resolveAuthHeaders(ctx, sandboxAuth?.credentialId ?? null);

  let rawResult: unknown;
  try {
    rawResult = await callTool(input.toolName, input.args ?? {}, { inputSchema: item.schemaJson as object }, { endpointUrl: sandboxTransport.endpointUrl, headers });
  } catch (err) {
    if (err instanceof McpTransportError) throw new McpDiscoveryFailedError(err.message);
    throw err;
  }

  const response: McpDryRunResponse = { toolName: input.toolName, environment: "Sandbox", rawResult, ranAt: new Date().toISOString() };
  const updated = await patchDraft(ctx, id, {}, 9, { dryRunResult: response });
  return { draft: updated, response };
}

/**
 * Step 9 — enrol. Re-validates the whole draft (a client cannot skip a step by
 * calling this early — LLD §14.3.4): every prior step's payload slice must be
 * present, and the dry run must have actually run. Writes the real `mcp_server` +
 * `mcp_server_version` (`Approved`) + `mcp_manifest_item` + one `connector`/
 * `mcp_environment_binding` per environment, materialises enabled `Tool` items into
 * `tool` rows, and deletes the consumed draft.
 *
 * Any item never explicitly classified fails closed here — `Tier3`, disabled,
 * `Write` (the conservative direction) — matching ADR-0014 §2.2's fail-closed
 * default for an unreviewed item exactly.
 */
export async function submitEnrol(ctx: TenantContext, id: string, actorUserId: string): Promise<McpEnrolResponse> {
  const draft = await requireDraft(ctx, id);
  const { identify, transport, auth, classify, grouping, policy } = draft.payload;
  if (!identify || !transport || !auth || !draft.discoverySnapshot || !policy || !draft.dryRunResult) {
    throw new McpWizardStepOutOfOrderError(9, draft.step);
  }
  if (transport.bindings.length === 0) throw new McpBindingRequiredError();

  const items: WizardManifestItemInput[] = draft.discoverySnapshot.map((snap) => {
    const key = `${snap.kind}:${snap.name}`;
    const cls = classify?.[key];
    const grp = grouping?.[key];
    const ioClass = (cls?.ioClass as "Read" | "Write" | undefined) ?? "Write";
    const approvalTier = (cls?.approvalTier as "Tier1" | "Tier2" | "Tier3" | undefined) ?? "Tier3";
    return {
      kind: snap.kind,
      name: snap.name,
      descriptionSource: cls?.descriptionOverride ?? snap.descriptionSource,
      schemaJson: snap.schemaJson,
      schemaHash: snap.schemaHash,
      ioClass,
      ioClassSource: cls?.ioClass ? "AdminOverride" : "AutoHeuristic",
      approvalTier,
      approvalTierSource: cls?.approvalTier ? "AdminOverride" : "BackendTypeDefault",
      enabled: cls?.enabled ?? false,
      capabilityGroupId: grp?.capabilityGroupId ?? null,
      knowledgeIngestionCandidate: cls?.knowledgeIngestionCandidate ?? false,
      toolId: null,
    };
  });

  // One `connector` row per environment binding (`@nextbot/connectors`, a separate
  // module transaction — see `mcp-server-repository.ts`'s `createServerFromWizard`
  // doc comment for why this can't be one atomic cross-module transaction).
  const bindings: WizardBindingInput[] = [];
  for (const t of transport.bindings) {
    const a = auth.bindings.find((b) => b.environment === t.environment);
    const connectorId = await insertConnector(ctx, {
      name: identify.name,
      description: identify.description ?? undefined,
      backendType: identify.backendType as BackendTypeValue,
      transport: t.transport as "StreamableHTTP" | "StdioViaGateway",
      endpointUrl: t.endpointUrl ?? undefined,
      authMethod: (a?.authMethod as ConnectorAuthMethodValue) ?? "None",
      credentialId: a?.credentialId ?? null,
      environment: t.environment as "Sandbox" | "Staging" | "Production",
    });
    bindings.push({
      environment: t.environment as "Sandbox" | "Staging" | "Production",
      endpointUrl: t.endpointUrl,
      stdioCommand: t.stdioCommand,
      gatewayAgentId: null,
      credentialId: a?.credentialId ?? null,
      connectorId,
      reachability: "Unknown",
    });
  }

  // `transport.bindings.length === 0` already threw above, so this array is
  // non-empty — the `[0]` fallback always resolves, TypeScript's indexed-access
  // typing just can't see that invariant.
  const canonicalTransport = transport.bindings.find((b) => b.environment === "Sandbox") ?? transport.bindings[0]!;
  const canonicalAuth = auth.bindings.find((b) => b.environment === "Sandbox") ?? auth.bindings[0];

  const created = await createServerFromWizard(ctx, {
    name: identify.name,
    description: identify.description,
    backendType: identify.backendType as BackendTypeValue,
    ownerUserId: identify.ownerUserId,
    criticality: identify.criticality as McpCriticalityValue,
    transport: canonicalTransport.transport as "StreamableHTTP" | "StdioViaGateway",
    authMethod: (canonicalAuth?.authMethod as ConnectorAuthMethodValue) ?? "None",
    policyJson: policy,
    items,
    bindings,
    createdByUserId: actorUserId,
  });

  // Materialise enabled `Tool` items into real `tool` rows (`@nextbot/tool-registry`,
  // another separate module transaction) against the highest-priority environment's
  // connector — Production if bound, else Staging, else Sandbox — matching where an
  // agent actually invokes the tool at runtime.
  const targetBinding =
    created.bindingIds.find((b) => b.environment === "Production") ?? created.bindingIds.find((b) => b.environment === "Staging") ?? created.bindingIds[0];

  const materialisedToolIds: string[] = [];
  if (targetBinding) {
    for (const item of items) {
      if (item.kind !== "Tool" || !item.enabled) continue;
      const result = await upsertToolFromDiscovery(ctx, {
        connectorId: targetBinding.connectorId,
        name: item.name,
        descriptionSource: item.descriptionSource,
        rwClass: item.ioClass,
        approvalTier: item.approvalTier,
        inputSchema: item.schemaJson as object,
        outputSchema: {},
      });
      // `upsertToolFromDiscovery` has no capability-group concept of its own (a v1
      // discovery-sync tool always starts Ungrouped) — the wizard's step 6 grouping
      // decision is applied as an explicit follow-up write, matching the single-FK
      // model exactly (LLD §14.3.3).
      if (item.capabilityGroupId) await setToolCapabilityGroup(ctx, result.toolId, item.capabilityGroupId);
      await linkManifestItemToTool(ctx, created.serverVersionId, "Tool", item.name, result.toolId);
      materialisedToolIds.push(result.toolId);
    }
  }

  await deleteDraft(ctx, id);

  return {
    serverId: created.serverId,
    serverVersionId: created.serverVersionId,
    version: created.version,
    manifestHash: created.manifestHash,
    bindings: created.bindingIds.map((b) => ({ environment: b.environment as "Sandbox" | "Staging" | "Production", connectorId: b.connectorId, reachability: b.reachability as "Unknown" | "Reachable" | "Unreachable" })),
    materialisedToolIds,
    // FR-MCP-16 step 9's audit write happens at the composition root
    // (`apps/web`'s route handler, `recordAdminAudit`) — `packages/modules/**`
    // cannot import `@nextbot/audit` directly (LLD §2.3's allow-list), the same
    // reason every other CRUD write's audit entry is recorded one layer up (see
    // `apps/web/src/lib/record-admin-audit.ts`'s own doc comment).
    auditLogEntryId: null,
  };
}
