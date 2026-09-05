import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { parse as parseYaml } from 'yaml';
import type { CreateToolRequest, TestInvokeToolResultDto, ToolDto, UpdateToolRequest } from '@liveavatar/contracts';
import { DeploymentConfigApiService, ToolsApiService, type AppClientError } from '@liveavatar/web-shared';

/** `agent.tools[]` entry shape (`packages/contracts/src/agent-config/schema.ts`). */
interface AttachedToolRef {
  name: string;
  api_ref: string;
  enabled?: boolean;
}

/** Minimal shape this store cares about from the parsed draft YAML. */
interface DraftAgentConfig {
  agent?: { tools?: AttachedToolRef[] };
  [key: string]: unknown;
}

interface ToolsState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: ToolDto[];
  /** Create/update/delete in flight — disables row actions and the create form's submit button. */
  mutating: boolean;
  /** Tool id currently running a test-invoke, or null. */
  testingId: string | null;
  /** Last test-invoke result per tool id (BL-033's "Test" action). */
  testResults: Record<string, TestInvokeToolResultDto>;
  /**
   * Full current draft config, parsed from `GET /tenants/:id/config`'s
   * `yaml_text` — kept only so attach/detach can round-trip the *whole*
   * draft on save (a partial `{agent: {tools}}` PUT would silently wipe
   * every other draft field). Deliberately a local, minimal read-modify-write
   * rather than an `AgentBuilderStore` import: the admin SPA's ESLint
   * feature-isolation zones (`eslint.config.mjs` `webFeatures`) forbid one
   * feature reaching into another's store, so this mirrors
   * `AgentBuilderStore`'s *pattern* (LLD-style draft/ifMatch/save) rather
   * than importing that store instance — see
   * `docs/plans/agent-builder-v2-plan.md` Phase 8.
   */
  draftConfig: DraftAgentConfig | null;
  /** ISO `updated_at` from the same config fetch — the `If-Match` token for attach/detach saves. */
  draftIfMatch: string | null;
  /** An attach/detach save is in flight. */
  attaching: boolean;
}

const initialState: ToolsState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  mutating: false,
  testingId: null,
  testResults: {},
  draftConfig: null,
  draftIfMatch: null,
  attaching: false,
};

/** Tool registry CRUD + agent-level attach/detach state (Tools tab, BL-033/034). */
export const ToolsStore = signalStore(
  { providedIn: 'root' },
  withState<ToolsState>(initialState),
  withMethods((store) => {
    const api = inject(ToolsApiService);
    const configApi = inject(DeploymentConfigApiService);

    function reloadList(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      api.list(tenantId).subscribe({
        next: (response) => patchState(store, { items: response.items, status: 'ready' }),
        error: (error: AppClientError) => patchState(store, { status: 'error', loadError: error }),
      });
    }

    function reloadDraft(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      configApi.get(tenantId).subscribe({
        next: (config) => {
          let parsed: DraftAgentConfig = {};
          if (config.yaml_text) {
            try {
              parsed = (parseYaml(config.yaml_text) as DraftAgentConfig) ?? {};
            } catch {
              parsed = {};
            }
          }
          patchState(store, { draftConfig: parsed, draftIfMatch: config.updated_at });
        },
        error: () => undefined,
      });
    }

    return {
      load(tenantId: string): void {
        patchState(store, { ...initialState, tenantId, status: 'loading' });
        reloadList();
        reloadDraft();
      },

      /** Currently attached (agent-level, "always available") tool refs. */
      attachedRefs(): Set<string> {
        return new Set((store.draftConfig()?.agent?.tools ?? []).map((t) => t.api_ref));
      },

      create(body: CreateToolRequest, onSuccess?: (tool: ToolDto) => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.create(tenantId, body).subscribe({
          next: (tool) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(tool);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      update(
        toolId: string,
        body: UpdateToolRequest,
        ifMatch: string,
        onSuccess?: (tool: ToolDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.update(tenantId, toolId, body, ifMatch).subscribe({
          next: (tool) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(tool);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      remove(toolId: string, onSuccess?: () => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.delete(tenantId, toolId).subscribe({
          next: () => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.();
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      testInvoke(toolId: string, args: Record<string, unknown>): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { testingId: toolId });
        api.testInvoke(tenantId, toolId, { arguments: args }).subscribe({
          next: (result) => {
            patchState(store, {
              testingId: null,
              testResults: { ...store.testResults(), [toolId]: result },
            });
          },
          error: () => patchState(store, { testingId: null }),
        });
      },

      /**
       * Attaches/detaches `tool` as an agent-level "always available" tool
       * by editing the current draft's `agent.tools[]` and saving through
       * the existing `PUT /tenants/:id/config` (`save_as: 'draft'`) flow —
       * per the resolved design decision (`docs/plans/agent-builder-v2-plan.md`
       * Phase 8): no dedicated attach/detach endpoint.
       */
      toggleAttach(
        tool: ToolDto,
        onSuccess?: (attached: boolean) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        const ifMatch = store.draftIfMatch();
        const draft = store.draftConfig();
        if (!tenantId || !ifMatch || !draft) {
          return;
        }
        const current = draft.agent?.tools ?? [];
        const wasAttached = current.some((t) => t.api_ref === tool.api_ref);
        const tools = wasAttached
          ? current.filter((t) => t.api_ref !== tool.api_ref)
          : [...current, { name: tool.name, api_ref: tool.api_ref, enabled: true }];
        const nextConfig = { ...draft, agent: { ...draft.agent, tools } };

        patchState(store, { attaching: true });
        configApi.save(tenantId, { config: nextConfig, save_as: 'draft' }, ifMatch).subscribe({
          next: (config) => {
            let parsed: DraftAgentConfig = {};
            if (config.yaml_text) {
              try {
                parsed = (parseYaml(config.yaml_text) as DraftAgentConfig) ?? {};
              } catch {
                parsed = {};
              }
            }
            patchState(store, { attaching: false, draftConfig: parsed, draftIfMatch: config.updated_at });
            onSuccess?.(!wasAttached);
          },
          error: (error: AppClientError) => {
            patchState(store, { attaching: false });
            onError?.(error);
          },
        });
      },
    };
  }),
);
