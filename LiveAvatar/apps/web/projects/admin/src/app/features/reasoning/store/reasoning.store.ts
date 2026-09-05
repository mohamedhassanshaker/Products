import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Subject, debounceTime } from 'rxjs';
import { parse as parseYaml } from 'yaml';
import type {
  ConfigErrorDto,
  CriticalPathReportDto,
  GraphNode,
  ProviderCredentialDto,
  ProviderDefinitionDto,
  Reasoning,
  TestCallResponseDto,
  ValidateConfigResponseDto,
} from '@liveavatar/contracts';
import {
  DeploymentConfigApiService,
  HitlApiService,
  ProvidersApiService,
  SkillsApiService,
  TenantsApiService,
  ToolsApiService,
  type AppClientError,
} from '@liveavatar/web-shared';
import type { HitlGateDto, SkillDto, TenantListItemDto, ToolDto } from '@liveavatar/contracts';
import { buildSingleLlmNodeGraph, createDefaultNode, generateNodeId, type NodeType } from './node-factory';

/** Debounce before re-running `POST /config/validate` on every edit — same cadence as `agent-builder.store.ts` (UX_GUIDELINES §10.2). */
const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Minimal shape this store cares about from the parsed draft YAML — same
 * "local read-modify-write, not an `AgentBuilderStore` import" pattern
 * `ToolsStore` uses (`features/tools/store/tools.store.ts`), for the same
 * ESLint feature-isolation reason (`eslint.config.mjs` `webFeatures`).
 *
 * Phase 16 (BL-063, `docs/v2/UX_SCOPE.md`'s Reasoning-tab resolution —
 * `agent.system_prompt`/`runtime`/`memory` have no named tab anywhere in the
 * source docs, and belong here because the system prompt is literally what
 * V-11's "core_tokens" term already measures as part of the *reasoning*
 * cost) adds the `agent` slice this store now also owns: the "Core
 * instructions" section, moved out of the old `agent-builder-page` this
 * phase decommissions (`agent-builder.store.ts`'s `AgentConfigDraft.agent`
 * keeps the same shape typed against the real contract, unchanged, purely
 * so *that* store can still round-trip `agent.tools` for its own unrelated
 * concerns — this store owns the editing surface for `system_prompt`/
 * `runtime`/`memory` now, same "one feature actually edits it, others keep
 * a read-only mirror" split Phase 9 already established for `reasoning`
 * itself).
 */
interface DraftAgentConfig {
  reasoning?: Reasoning;
  agent?: {
    runtime?: string;
    system_prompt?: string;
    memory?: { enabled?: boolean; window_turns?: number };
  };
  [key: string]: unknown;
}

interface ReasoningState {
  tenantId: string | null;
  tenantName: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  configStatus: 'draft' | 'published' | null;
  /** ISO `updated_at` — doubles as the `If-Match` token, same as `AgentBuilderStore`. */
  ifMatch: string | null;
  draftConfig: DraftAgentConfig | null;
  dirty: boolean;
  definitions: ProviderDefinitionDto[];
  credentials: ProviderCredentialDto[];
  tools: ToolDto[];
  /** Phase 13 (BL-049/050/051) — every tenant skill, for the Skill node's `skill_id` picker. */
  skills: SkillDto[];
  /** Phase 14 (BL-052/053) — every tenant HITL gate, for the HITL node's `gate_id` picker. */
  gates: HitlGateDto[];
  /**
   * Phase 15 (BL-058) — every tenant this admin can see, for the Sub-agent
   * node's `target_tenant_id` picker. Reuses `TenantsApiService.list()`
   * (the same underlying call `TenantSelectComponent` makes elsewhere in
   * this app) rather than a new endpoint — see `NodeInspectorData.tenants`'s
   * doc comment for why this list is deliberately unfiltered.
   */
  tenants: TenantListItemDto[];
  validating: boolean;
  validateResult: ValidateConfigResponseDto | null;
  saving: 'draft' | 'published' | null;
  saveAlert: string | null;
  conflict: boolean;
  testCallRunning: boolean;
  testCallResult: TestCallResponseDto | null;
  testCallError: AppClientError | null;
}

const initialState: ReasoningState = {
  tenantId: null,
  tenantName: '',
  status: 'idle',
  loadError: null,
  configStatus: null,
  ifMatch: null,
  draftConfig: null,
  dirty: false,
  definitions: [],
  credentials: [],
  tools: [],
  skills: [],
  gates: [],
  tenants: [],
  validating: false,
  validateResult: null,
  saving: null,
  saveAlert: null,
  conflict: false,
  testCallRunning: false,
  testCallResult: null,
  testCallError: null,
};

/**
 * Reasoning tab working-draft state (Phase 9, BL-035/036/037). Mirrors
 * `AgentBuilderStore`'s debounced-validate/save shape, but — like
 * `ToolsStore` — owns a *local* read-modify-write of the whole draft config
 * rather than importing `AgentBuilderStore` directly, because
 * `config.reasoning` is one field inside the same whole-config draft Tools
 * edits `agent.tools` on (`GET`/`PUT /tenants/:id/config`), not its own
 * resource-scoped API.
 */
export const ReasoningStore = signalStore(
  { providedIn: 'root' },
  withState<ReasoningState>(initialState),
  withComputed(({ draftConfig, validateResult, configStatus, dirty }) => ({
    /** `config.reasoning`, or `null` for a brand-new tenant (R-G1's empty-state case — no LLM chosen yet, see `node-factory.ts`). */
    reasoning: computed<Reasoning | null>(() => draftConfig()?.reasoning ?? null),
    /** `config.agent` — the "Core instructions" section's backing slice (Phase 16, BL-063). */
    agent: computed(() => draftConfig()?.agent ?? {}),
    /** Publish is structurally impossible while the last validate result is invalid, same rule as `AgentBuilderStore` (UX_GUIDELINES §10.8). */
    canPublish: computed(() => validateResult()?.valid === true),
    /**
     * Phase 10 (BL-040/041) — critical-path/turn-budget data for the turn
     * budget panel. Already flows through the existing debounced-validate
     * plumbing (`/config/validate`'s response), so this is a plain selector,
     * not a new HTTP call.
     */
    criticalPath: computed<CriticalPathReportDto | null>(() => validateResult()?.critical_path ?? null),
    hasUnpublishedChanges: computed(() => configStatus() === 'published' && dirty()),
    /**
     * Per-node validation errors (UX_SCOPE.md "Reasoning tab" — "mirrors the
     * existing per-layer inline-error pattern... extended from 'layer' to
     * 'node id'"). Maps `layer: 'reasoning.graph'` errors by their `field`
     * (a node id, or `${nodeId}/on_error` etc. — see
     * `apps/api/.../domain/graph-structure.ts`), `reasoning.entry_node_id`
     * by its `field` (the dangling entry id), and `reasoning.llm`/
     * `reasoning.llm.fallback` (Gate B's provider/credential/residency
     * checks, which reason about "the first llm node") by that node's id.
     */
    errorsByNode: computed(() => {
      const map = new Map<string, ConfigErrorDto[]>();
      const graph = draftConfig()?.reasoning?.graph ?? [];
      const firstLlmNodeId = graph.find((n) => n.type === 'llm')?.id;
      for (const error of validateResult()?.errors ?? []) {
        let nodeId: string | undefined;
        if (error.layer === 'reasoning.graph' && error.field) {
          nodeId = error.field.split('/')[0];
        } else if (error.layer === 'reasoning.entry_node_id') {
          nodeId = error.field;
        } else if (error.layer === 'reasoning.llm' || error.layer === 'reasoning.llm.fallback') {
          nodeId = firstLlmNodeId;
        }
        if (!nodeId) {
          continue;
        }
        const list = map.get(nodeId) ?? [];
        list.push(error);
        map.set(nodeId, list);
      }
      return map;
    }),
    /**
     * Errors that don't attach to any node card — shown in a banner instead
     * (never silently dropped). Excludes `agent.system_prompt` (Phase 16):
     * that error is shown inline under the Core Instructions textarea via
     * `errorsByLayer` below instead, the same "one field, one display site"
     * rule this filter already applies to every `reasoning.*` layer.
     */
    globalErrors: computed(() => {
      const graph = draftConfig()?.reasoning?.graph ?? [];
      const hasLlmNode = graph.some((n) => n.type === 'llm');
      return (validateResult()?.errors ?? []).filter((error) => {
        if (error.layer === 'reasoning.graph' || error.layer === 'reasoning.entry_node_id') {
          return false;
        }
        if ((error.layer === 'reasoning.llm' || error.layer === 'reasoning.llm.fallback') && hasLlmNode) {
          return false;
        }
        if (error.layer === 'agent.system_prompt') {
          return false;
        }
        return true;
      });
    }),
    /**
     * Phase 16 (BL-063) — same per-layer grouping `AgentBuilderStore`
     * already uses for `stt`/`tts`/`avatar`, needed here only for
     * `agent.system_prompt` (`CONFIG_PROMPT_TOO_LARGE`, set explicitly by
     * `combination-rules.ts`, unlike a bare Gate A structural error).
     */
    errorsByLayer: computed(() => {
      const map = new Map<string, ConfigErrorDto[]>();
      for (const error of validateResult()?.errors ?? []) {
        const key = error.layer ?? '_global';
        const list = map.get(key) ?? [];
        list.push(error);
        map.set(key, list);
      }
      return map;
    }),
  })),
  withMethods((store) => {
    const configApi = inject(DeploymentConfigApiService);
    const providersApi = inject(ProvidersApiService);
    const tenantsApi = inject(TenantsApiService);
    const toolsApi = inject(ToolsApiService);
    const skillsApi = inject(SkillsApiService);
    const hitlApi = inject(HitlApiService);

    const validateRequest$ = new Subject<void>();
    let debounceWired = false;

    function runValidate(): void {
      const tenantId = store.tenantId();
      const draft = store.draftConfig();
      if (!tenantId || !draft) {
        return;
      }
      patchState(store, { validating: true });
      configApi.validate(tenantId, { config: draft }).subscribe({
        next: (result) => patchState(store, { validating: false, validateResult: result }),
        error: () => patchState(store, { validating: false }),
      });
    }

    function wireDebounce(): void {
      if (debounceWired) {
        return;
      }
      debounceWired = true;
      // Deliberately `debounceTime` only, no `distinctUntilChanged` — real
      // bug found and fixed in Phase 13 (BL-049/050/051): `validateRequest$`
      // is a `Subject<void>`, so every emission carries the same value
      // (`undefined`). `distinctUntilChanged`'s default `===` comparator
      // therefore treats every emission after the very first as a
      // duplicate and silently drops it, meaning `runValidate()` fired only
      // once per store instance (once per tab, ever) — every edit burst
      // after the first never re-validated. Verified with a standalone
      // RxJS repro before fixing. `agent-builder.store.ts` and
      // `knowledge-pipeline.store.ts` had the identical bug, from the same
      // copied pattern, and are fixed the same way in this same phase.
      validateRequest$.pipe(debounceTime(VALIDATE_DEBOUNCE_MS)).subscribe(() => runValidate());
    }

    /** Applies a new `reasoning` value to the draft, marks dirty, and schedules a debounced validate. */
    function setReasoning(reasoning: Reasoning): void {
      const draft = store.draftConfig() ?? {};
      patchState(store, {
        draftConfig: { ...draft, reasoning },
        dirty: true,
        saveAlert: null,
        conflict: false,
      });
      validateRequest$.next();
    }

    /** Shallow-merges a patch into `config.agent` (Phase 16's Core Instructions section) — same shape as `setReasoning`. */
    function patchAgent(patch: Partial<NonNullable<DraftAgentConfig['agent']>>): void {
      const draft = store.draftConfig() ?? {};
      patchState(store, {
        draftConfig: { ...draft, agent: { ...draft.agent, ...patch } },
        dirty: true,
        saveAlert: null,
        conflict: false,
      });
      validateRequest$.next();
    }

    function loadFn(tenantId: string): void {
      wireDebounce();
      patchState(store, { ...initialState, tenantId, status: 'loading' });

      tenantsApi.get(tenantId).subscribe({
        next: (tenant) => patchState(store, { tenantName: tenant.name }),
        error: () => undefined,
      });
      providersApi.listDefinitions({ enabled: true }).subscribe((response) => {
        patchState(store, { definitions: response.items });
      });
      providersApi.listCredentials(tenantId).subscribe((response) => {
        patchState(store, { credentials: response.items });
      });
      toolsApi.list(tenantId).subscribe({
        next: (response) => patchState(store, { tools: response.items }),
        error: () => undefined,
      });
      skillsApi.list(tenantId).subscribe({
        next: (response) => patchState(store, { skills: response.items }),
        error: () => undefined,
      });
      hitlApi.listGates(tenantId).subscribe({
        next: (response) => patchState(store, { gates: response.items }),
        error: () => undefined,
      });
      // Phase 15 (BL-058) — Sub-agent's `target_tenant_id` picker. Same
      // `TenantsApiService.list()` call `TenantSelectComponent` makes
      // elsewhere in this app; `page_size: 100` (the API's own max) rather
      // than paginating, matching this tab's "reuse what's already loaded,
      // don't build new pagination UI for a v1 picker" scope.
      tenantsApi.list({ page: 1, page_size: 100 }).subscribe({
        next: (response) => patchState(store, { tenants: response.items }),
        error: () => undefined,
      });

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
          patchState(store, {
            status: 'ready',
            configStatus: config.status,
            ifMatch: config.updated_at,
            draftConfig: parsed,
            dirty: false,
          });
          runValidate();
        },
        error: (error: AppClientError) => patchState(store, { status: 'error', loadError: error }),
      });
    }

    return {
      load: loadFn,

      /** R-G1 empty state: creates the default single-LLM-node graph for a brand-new tenant that has chosen an LLM provider/model. */
      initializeDefaultGraph(leg: { provider: string; credential_ref?: string; model: string }): void {
        setReasoning(buildSingleLlmNodeGraph(leg));
      },

      /** Appends a new node of `type` with schema-valid defaults; returns its id so the caller can open its inspector. */
      addNode(type: NodeType): string | null {
        const reasoning = store.reasoning();
        if (!reasoning) {
          return null;
        }
        const id = generateNodeId(reasoning.graph.map((n) => n.id), type);
        const node = createDefaultNode(type, id);
        setReasoning({ ...reasoning, graph: [...reasoning.graph, node] });
        return id;
      },

      /** Replaces one node (matched by id) with `updated` — the inspector's save action. */
      updateNode(nodeId: string, updated: GraphNode): void {
        const reasoning = store.reasoning();
        if (!reasoning) {
          return;
        }
        const graph = reasoning.graph.map((n) => (n.id === nodeId ? updated : n));
        setReasoning({ ...reasoning, graph });
      },

      /** Removes a node. Does not rewrite other nodes' dangling references — Gate A reports those (`CONFIG_GRAPH_REF_UNKNOWN`) rather than this silently repointing edges the admin didn't ask to change. */
      removeNode(nodeId: string): void {
        const reasoning = store.reasoning();
        if (!reasoning) {
          return;
        }
        const graph = reasoning.graph.filter((n) => n.id !== nodeId);
        setReasoning({ ...reasoning, graph });
      },

      /** Turn-budget field — the only reasoning-level (not per-node) field this tab edits this phase. */
      setEntryNodeId(entry_node_id: string): void {
        const reasoning = store.reasoning();
        if (!reasoning) {
          return;
        }
        setReasoning({ ...reasoning, entry_node_id });
      },

      setTurnBudgetMs(turn_budget_ms: number): void {
        const reasoning = store.reasoning();
        if (!reasoning) {
          return;
        }
        setReasoning({ ...reasoning, turn_budget_ms });
      },

      /** Core Instructions section (Phase 16, BL-063). */
      setRuntime(runtime: string): void {
        patchAgent({ runtime });
      },

      setSystemPrompt(system_prompt: string): void {
        patchAgent({ system_prompt });
      },

      setMemoryEnabled(enabled: boolean): void {
        patchAgent({ memory: { ...store.agent().memory, enabled } });
      },

      setMemoryWindowTurns(window_turns: number): void {
        patchAgent({ memory: { ...store.agent().memory, window_turns } });
      },

      saveDraft(onSuccess?: () => void): void {
        save('draft', onSuccess);
      },

      publish(onSuccess?: () => void): void {
        save('published', onSuccess);
      },

      reloadAfterConflict(): void {
        const tenantId = store.tenantId();
        if (tenantId) {
          loadFn(tenantId);
        }
      },

      /** Shared Test-call harness (BL-037) — `POST /tenants/:id/config/test-call` against the current draft. */
      runTestCall(utterance: string): void {
        const tenantId = store.tenantId();
        const draft = store.draftConfig();
        if (!tenantId || !draft) {
          return;
        }
        patchState(store, { testCallRunning: true, testCallError: null });
        configApi.testCall(tenantId, { config: draft, utterance }).subscribe({
          next: (result) => patchState(store, { testCallRunning: false, testCallResult: result }),
          error: (error: AppClientError) => patchState(store, { testCallRunning: false, testCallError: error }),
        });
      },
    };

    function save(saveAs: 'draft' | 'published', onSuccess?: () => void): void {
      const tenantId = store.tenantId();
      const ifMatch = store.ifMatch();
      const draft = store.draftConfig();
      if (!tenantId || !ifMatch || !draft) {
        return;
      }
      patchState(store, { saving: saveAs, saveAlert: null });
      configApi.save(tenantId, { config: draft, save_as: saveAs }, ifMatch).subscribe({
        next: (config) => {
          let parsed: DraftAgentConfig = {};
          if (config.yaml_text) {
            try {
              parsed = (parseYaml(config.yaml_text) as DraftAgentConfig) ?? {};
            } catch {
              parsed = {};
            }
          }
          patchState(store, {
            saving: null,
            configStatus: config.status,
            ifMatch: config.updated_at,
            draftConfig: parsed,
            dirty: false,
          });
          runValidate();
          onSuccess?.();
        },
        error: (error: AppClientError) => {
          patchState(store, { saving: null });
          if (error.code === 'CONFIG_CONFLICT') {
            patchState(store, { conflict: true });
            return;
          }
          patchState(store, { saveAlert: error.message });
        },
      });
    }
  }),
);
