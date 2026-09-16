"use server";

/**
 * Server Actions for `/tools` (B5: Tools & MCP registry) — every write on this screen.
 *
 * ## One permission for the whole screen: `agents:manage`
 *
 * There is deliberately no `tools:*` permission key — `modules/iam/domain/permissions.ts`'s
 * `PERMISSIONS` array has no `tools:` entry, because B9 tab 3's own matrix never offers one.
 * B5 is the estate-wide view of exactly the catalogue the agent wizard's step 4 draws from, so
 * it gates on the same permission that screen does: `agents:manage`. `agents:publish` is
 * pointedly *not* required anywhere here — an Agent Designer (who has `agents:manage` but not
 * `agents:publish`) must be able to register a connector or reset a breaker, since none of
 * that releases anything to citizens.
 *
 * Checked here, in the caller, per api.md §12 invariant 2 — the use cases in `modules/tools`
 * do not check permissions themselves. Same convention `iam/actions.ts` established.
 *
 * ## Why almost every action returns `ActionResult<TheUseCase'sOwnResult>`
 *
 * Nothing in `modules/tools` throws a named error class. Every business-rule outcome is a
 * `{ ok: false, reason: "..." }` **value** — "this skill is still bound to 3 agent versions",
 * "the MCP runtime is not reachable yet", "connection testing is not implemented". Those are
 * not faults; they are results this screen has to render specifically and honestly (a count, a
 * detail string, a distinct message per handshake failure), so collapsing them into a generic
 * error string would destroy the very information the UI needs — the same reason
 * `iam/actions.ts`'s `updateRolePermissionsAction` returns its raw `UpdatePermissionsResult`.
 *
 * What is left over is genuinely exceptional: a lost database connection, a corrupt row, an
 * invariant guard (`TripCircuitBreaker` throws on an empty `reason`). Those must not surface as
 * Next's unhandled-Server-Action overlay, so every action still catches them.
 *
 * Hence the two nested layers, which are two different questions and not redundancy:
 *   - outer `ActionResult`: did the call complete at all? (`ok: false` carries `error`)
 *   - inner use-case result: what did the business rule decide? (`ok: false` carries `reason`)
 *
 * Actions whose use case has no failure branch at all (`create*`, `update*`) flatten to
 * `ActionResult<{ id }>`, exactly like `iam/actions.ts`'s `createTeamAction`.
 */

import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ConnectAndDiscoverMcpServer } from "../../../../modules/tools/application/connect-and-discover-mcp-server.js";
import { CreateApiConnector } from "../../../../modules/tools/application/create-api-connector.js";
import { CreateMcpServer } from "../../../../modules/tools/application/create-mcp-server.js";
import { CreateNativeSkill } from "../../../../modules/tools/application/create-native-skill.js";
import { DeleteApiConnector } from "../../../../modules/tools/application/delete-api-connector.js";
import { DeleteMcpServer } from "../../../../modules/tools/application/delete-mcp-server.js";
import { DeleteSkill } from "../../../../modules/tools/application/delete-skill.js";
import { ResetCircuitBreaker } from "../../../../modules/tools/application/reset-circuit-breaker.js";
import { TestApiConnector } from "../../../../modules/tools/application/test-api-connector.js";
import { TripCircuitBreaker } from "../../../../modules/tools/application/trip-circuit-breaker.js";
import { UpdateApiConnector } from "../../../../modules/tools/application/update-api-connector.js";
import { UpdateCircuitBreakerConfig } from "../../../../modules/tools/application/update-circuit-breaker-config.js";
import { UpdateMcpServer } from "../../../../modules/tools/application/update-mcp-server.js";
import { UpdateSkill } from "../../../../modules/tools/application/update-skill.js";
import type { ConnectAndDiscoverMcpServerResult } from "../../../../modules/tools/application/connect-and-discover-mcp-server.js";
import type { ResetCircuitBreakerResult } from "../../../../modules/tools/application/reset-circuit-breaker.js";
import type { TestApiConnectorResult } from "../../../../modules/tools/application/test-api-connector.js";
import type { TripCircuitBreakerResult } from "../../../../modules/tools/application/trip-circuit-breaker.js";
import type { DeleteApiConnectorResult } from "../../../../modules/tools/ports/api-connector-repository.js";
import type { DeleteMcpServerResult } from "../../../../modules/tools/ports/mcp-server-repository.js";
import type { DeleteSkillResult } from "../../../../modules/tools/ports/skill-repository.js";
import type { FallbackStrategy } from "../../../../modules/tools/domain/circuit-breaker.js";
import type {
  ApiConnectorAuthMode,
  ApiConnectorMethod,
  McpAuthMode,
  McpTransport,
  RateLimitScope,
} from "../../../../modules/tools/domain/tool-catalog.js";
import {
  apiConnectorRepository,
  circuitBreakerRepository,
  circuitBreakerStateStore,
  mcpDiscoveryClient,
  mcpServerRepository,
  now,
  skillRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "agents:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Tab 1 — Skills catalogue
// ---------------------------------------------------------------------------

/**
 * Only `invocationKind: "Native"` skills can be created here. A skill projected from an API
 * connector or discovered from an MCP tool is created by *that* registration (a DB trigger for
 * connectors, discovery for MCP tools), so tab 1 shows those rows read-only — see
 * `skills-tab.tsx`.
 */
export interface CreateNativeSkillActionInput {
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly inputSchemaJson: string;
  readonly outputSchemaJson: string | null;
  readonly isAttachedByDefault: boolean;
}

export async function createNativeSkillAction(
  input: CreateNativeSkillActionInput,
): Promise<ActionResult<{ readonly skillId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.createNativeSkill");
        const result = await new CreateNativeSkill({ skills: skillRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { skillId: result.skill.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** The three fields `SkillRepository.update` accepts — schemas and invocation kind are immutable. */
export interface UpdateSkillActionInput {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
}

export async function updateSkillAction(
  input: UpdateSkillActionInput,
): Promise<ActionResult<{ readonly skillId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.updateSkill");
        await new UpdateSkill({ skills: skillRepository() }).execute({ ...input, now: now() });
        return { ok: true, value: { skillId: input.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Soft-deletes a skill, or reports that agent versions still bind it. `boundAgentVersionIds`
 * is carried through unflattened because the tab renders the real count — "still used by 3
 * agent versions" is actionable, "delete failed" is not.
 */
export async function deleteSkillAction(skillId: string): Promise<ActionResult<DeleteSkillResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.deleteSkill");
        const result = await new DeleteSkill({ skills: skillRepository() }).execute({
          id: skillId,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { skillId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — MCP servers
// ---------------------------------------------------------------------------

export interface CreateMcpServerActionInput {
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransport;
  readonly authMode: McpAuthMode;
  readonly credentialSecretRef: string | null;
}

export async function createMcpServerAction(
  input: CreateMcpServerActionInput,
): Promise<ActionResult<{ readonly mcpServerId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.createMcpServer");
        const result = await new CreateMcpServer({ servers: mcpServerRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { mcpServerId: result.server.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface UpdateMcpServerActionInput extends CreateMcpServerActionInput {
  readonly id: string;
}

export async function updateMcpServerAction(
  input: UpdateMcpServerActionInput,
): Promise<ActionResult<{ readonly mcpServerId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.updateMcpServer");
        await new UpdateMcpServer({ servers: mcpServerRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { mcpServerId: input.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deleteMcpServerAction(
  mcpServerId: string,
): Promise<ActionResult<DeleteMcpServerResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.deleteMcpServer");
        const result = await new DeleteMcpServer({ servers: mcpServerRepository() }).execute({
          id: mcpServerId,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { mcpServerId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Connect to a registered MCP server and re-discover its tool descriptors.
 *
 * The result union is returned whole, every branch intact, because each one means something
 * different to the operator and `mcp-servers-tab.tsx` renders each one differently — most
 * importantly `ai_runtime_unavailable`, whose `detail` says plainly that the `apps/ai` MCP
 * endpoint this adapter proxies to does not exist yet. Flattening that into "connection
 * failed" would claim a *broken* server where the truth is an *absent* runtime.
 */
export async function connectAndDiscoverMcpServerAction(
  mcpServerId: string,
): Promise<ActionResult<ConnectAndDiscoverMcpServerResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.connectAndDiscoverMcpServer");
        const result = await new ConnectAndDiscoverMcpServer({
          servers: mcpServerRepository(),
          discovery: mcpDiscoveryClient(),
        }).execute({ mcpServerId, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { mcpServerId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 3 — API connectors
// ---------------------------------------------------------------------------

/** The rate-limit policy every connector must be created with — a real nested object on `NewApiConnectorInput`, not a default this screen invents. */
export interface RateLimitPolicyActionInput {
  readonly name: string;
  readonly requestsPerWindow: number;
  readonly windowSeconds: number;
  readonly burst: number;
  readonly scope: RateLimitScope;
}

export interface CreateApiConnectorActionInput {
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly headersJson: string | null;
  readonly requestSchemaJson: string | null;
  readonly responseSchemaJson: string | null;
  readonly timeoutMs: number;
  readonly rateLimitPolicy: RateLimitPolicyActionInput;
}

export async function createApiConnectorAction(
  input: CreateApiConnectorActionInput,
): Promise<ActionResult<{ readonly apiConnectorId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.createApiConnector");
        const result = await new CreateApiConnector({
          connectors: apiConnectorRepository(),
        }).execute({ ...input, now: now() });
        return { ok: true, value: { apiConnectorId: result.connector.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** No `rateLimitPolicy`: `UpdateApiConnector` deliberately does not accept one — the policy row is edited on its own, not through the connector. */
export interface UpdateApiConnectorActionInput {
  readonly id: string;
  readonly name: string;
  readonly method: ApiConnectorMethod;
  readonly urlTemplate: string;
  readonly authMode: ApiConnectorAuthMode;
  readonly credentialSecretRef: string | null;
  readonly headersJson: string | null;
  readonly requestSchemaJson: string | null;
  readonly responseSchemaJson: string | null;
  readonly timeoutMs: number;
}

export async function updateApiConnectorAction(
  input: UpdateApiConnectorActionInput,
): Promise<ActionResult<{ readonly apiConnectorId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.updateApiConnector");
        await new UpdateApiConnector({ connectors: apiConnectorRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { apiConnectorId: input.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deleteApiConnectorAction(
  apiConnectorId: string,
): Promise<ActionResult<DeleteApiConnectorResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.deleteApiConnector");
        const result = await new DeleteApiConnector({
          connectors: apiConnectorRepository(),
        }).execute({ id: apiConnectorId, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { apiConnectorId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * "Test connection". `TestApiConnector`'s return type is `{ ok: false; reason:
 * "tools.test_execution_not_implemented" }` — not sometimes, always: there is no outbound-HTTP
 * execution infrastructure in this app yet. The action still exists, still checks permission,
 * and still returns that real result, so tab 3 can say so out loud instead of pretending a
 * request was made.
 */
export async function testApiConnectorAction(
  apiConnectorId: string,
): Promise<ActionResult<TestApiConnectorResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.testApiConnector");
        const result = await new TestApiConnector({
          connectors: apiConnectorRepository(),
        }).execute({ id: apiConnectorId, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { apiConnectorId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 4 — Resilience & fallbacks (circuit breakers)
// ---------------------------------------------------------------------------

export interface UpdateCircuitBreakerConfigActionInput {
  readonly id: string;
  readonly failureThreshold: number;
  readonly windowSeconds: number;
  readonly cooldownSeconds: number;
  readonly fallbackStrategy: FallbackStrategy;
  readonly serveCachedWhenDown: boolean;
  readonly cachedAnswerMaxAgeSeconds: number | null;
  readonly degradedModeMessage: string;
  readonly isEnabled: boolean;
}

export async function updateCircuitBreakerConfigAction(
  input: UpdateCircuitBreakerConfigActionInput,
): Promise<ActionResult<{ readonly circuitBreakerConfigId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.updateCircuitBreakerConfig");
        await new UpdateCircuitBreakerConfig({ breakers: circuitBreakerRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { circuitBreakerConfigId: input.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Manual reset — closes the breaker and writes a `ManualReset` event.
 *
 * `actorStaffUserId` is the *real* signed-in principal's id, taken from `withStaffAuth`'s own
 * context. It is not decoration: `CK_CircuitBreakerEvents_manualHasActor` rejects a null actor
 * at the database, and a manual state change to a shared dependency is exactly the kind of act
 * that has to be attributable to a person.
 */
export async function resetCircuitBreakerAction(
  circuitBreakerConfigId: string,
): Promise<ActionResult<ResetCircuitBreakerResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.resetCircuitBreaker");
        const result = await new ResetCircuitBreaker({
          breakers: circuitBreakerRepository(),
          state: circuitBreakerStateStore(),
        }).execute({
          circuitBreakerConfigId,
          actorStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { circuitBreakerConfigId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Manual trip (test) — opens the breaker so the fallback path can be demonstrated.
 *
 * `reason` is collected from a real text field, never hardcoded. `TripCircuitBreaker` requires
 * it (it throws on an empty string) and its own doc comment is candid that no column exists to
 * persist it yet — but the contract is the contract, and a caller that fabricated a constant
 * would be putting a lie where a justification belongs the moment that column lands.
 */
export async function tripCircuitBreakerAction(input: {
  readonly circuitBreakerConfigId: string;
  readonly reason: string;
}): Promise<ActionResult<TripCircuitBreakerResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "tools.tripCircuitBreaker");
        const result = await new TripCircuitBreaker({
          breakers: circuitBreakerRepository(),
          state: circuitBreakerStateStore(),
        }).execute({
          circuitBreakerConfigId: input.circuitBreakerConfigId,
          reason: input.reason,
          actorStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
