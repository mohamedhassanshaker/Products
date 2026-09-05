import type { ToolDefinitionRecord } from './tool-definition';
import type { TestInvokeResult } from './test-invoke-result';

/** Fields accepted on create. `apiRef` is always resolved by the use case before this call. */
export interface CreateToolDefinitionInput {
  tenantId: string;
  apiRef: string;
  name: string;
  description: string | null;
  method: string;
  url: string;
  credentialRef: string | null;
  requiresCredential: boolean;
  argsSchema: Record<string, unknown>;
  enabled: boolean;
  consequential: boolean;
  autonomousUseAckText: string | null;
  lane: 'foreground' | 'background';
  perSessionCap: number | null;
  perTurnCap: number | null;
  timeoutMs: number;
}

/** Partial fields accepted on update — `apiRef` is immutable once created. */
export type UpdateToolDefinitionInput = Partial<Omit<CreateToolDefinitionInput, 'tenantId' | 'apiRef'>>;

/**
 * `ToolDefinition` persistence (FR-AGENT-2, LLD §4.3). Phase 8 (BL-033)
 * upgrades this port from read-only to full CRUD — `deployment-config`'s
 * `CONFIG_TOOL_UNKNOWN` check and the agent's
 * `GET /internal/sessions/{id}/runtime-config` response both keep resolving
 * against `listByTenant`/`listEnabledByApiRefs`, unchanged.
 */
export interface ToolDefinitionRepositoryPort {
  /** Every tool definition for a tenant, enabled or not (existence check). */
  listByTenant(tenantId: string): Promise<ToolDefinitionRecord[]>;

  /** Only the enabled definitions matching the given `api_ref`s, in no particular order. */
  listEnabledByApiRefs(tenantId: string, apiRefs: string[]): Promise<ToolDefinitionRecord[]>;

  /** Single tool, tenant-scoped. */
  findById(tenantId: string, id: string): Promise<ToolDefinitionRecord | null>;

  /** Existence check for the `@@unique([tenantId, apiRef])` constraint (TOOL_API_REF_EXISTS). */
  findByApiRef(tenantId: string, apiRef: string): Promise<ToolDefinitionRecord | null>;

  create(input: CreateToolDefinitionInput): Promise<ToolDefinitionRecord>;

  /**
   * Optimistic-concurrency update — same `Date`-compared `updatedAt` shape
   * as `DeploymentConfigRepositoryPort.save` / `ProviderCredentialRepositoryPort.update`.
   */
  update(
    tenantId: string,
    id: string,
    input: UpdateToolDefinitionInput,
    ifMatch: Date,
  ): Promise<ToolDefinitionRecord | 'conflict' | 'missing'>;

  delete(tenantId: string, id: string): Promise<boolean>;
}

export const TOOL_DEFINITION_REPOSITORY = Symbol('TOOL_DEFINITION_REPOSITORY');

/**
 * One-shot HTTP tool invocation (BL-033's "Test" action). Implemented in
 * `infrastructure/tool-invoker.service.ts` as a NestJS re-implementation of
 * the Python agent's `ToolExecutor.invoke()` — see that file's docstring.
 */
export interface ToolInvokerPort {
  invoke(tool: ToolDefinitionRecord, args: Record<string, unknown>): Promise<TestInvokeResult>;
}

export const TOOL_INVOKER = Symbol('TOOL_INVOKER');
