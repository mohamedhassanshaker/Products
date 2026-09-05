import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Subject, debounceTime } from 'rxjs';
import { parse as parseYaml } from 'yaml';
import type {
  ConfigErrorDto,
  Knowledge,
  Reasoning,
  RetrievalPipelineConfig,
  RetrieveNode,
  ValidateConfigResponseDto,
} from '@liveavatar/contracts';
import { DeploymentConfigApiService, type AppClientError } from '@liveavatar/web-shared';

/** Debounce before re-running `POST /config/validate` on every edit — same cadence as `agent-builder.store.ts`/`reasoning.store.ts` (UX_GUIDELINES §10.2). */
const VALIDATE_DEBOUNCE_MS = 400;

/**
 * Minimal shape this store cares about from the parsed draft YAML — same
 * "local read-modify-write, not an `AgentBuilderStore` import" pattern
 * `ReasoningStore`/`ToolsStore` use, for the same ESLint feature-isolation
 * reason (`eslint.config.mjs` `webFeatures` — `knowledge` cannot import from
 * `features/agent-builder/**` or `features/reasoning/**`).
 */
interface DraftAgentConfig {
  knowledge?: Knowledge;
  reasoning?: Reasoning;
  [key: string]: unknown;
}

interface KnowledgePipelineState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  configStatus: 'draft' | 'published' | null;
  /** ISO `updated_at` — doubles as the `If-Match` token, same as `AgentBuilderStore`/`ReasoningStore`. */
  ifMatch: string | null;
  draftConfig: DraftAgentConfig | null;
  dirty: boolean;
  validating: boolean;
  validateResult: ValidateConfigResponseDto | null;
  saving: 'draft' | 'published' | null;
  saveAlert: string | null;
  conflict: boolean;
}

const initialState: KnowledgePipelineState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  configStatus: null,
  ifMatch: null,
  draftConfig: null,
  dirty: false,
  validating: false,
  validateResult: null,
  saving: null,
  saveAlert: null,
  conflict: false,
};

/**
 * Knowledge tab's Pipeline sub-tab working-draft state (Phase 12b,
 * BL-045/047/048). `knowledge.pipeline` is one field inside the same
 * whole-tenant `AgentConfig` the Reasoning/Tools tabs already edit
 * (`GET`/`PUT /tenants/:id/config`) — this store mirrors `ReasoningStore`'s
 * exact shape (own `draftConfig` signal, own debounced validate, own save)
 * rather than reusing `AgentBuilderStore` directly, matching the established
 * precedent that each tab owns an independent read-modify-write of the whole
 * draft rather than sharing one store across tabs (`ReasoningStore` does the
 * same despite "editing the same config" as `AgentBuilderStore`/`ToolsStore`).
 */
export const KnowledgePipelineStore = signalStore(
  { providedIn: 'root' },
  withState<KnowledgePipelineState>(initialState),
  withComputed(({ draftConfig, validateResult, configStatus, dirty }) => ({
    /** `config.knowledge.pipeline`, or `null` before the config has loaded / for a not-yet-migrated config. */
    pipeline: computed<RetrievalPipelineConfig | null>(() => draftConfig()?.knowledge?.pipeline ?? null),
    canPublish: computed(() => validateResult()?.valid === true),
    hasUnpublishedChanges: computed(() => configStatus() === 'published' && dirty()),
    /**
     * The first `retrieve`-type graph node's own `budget_ms` (this phase's
     * one real overall retrieval ceiling — see the plan doc's Phase 12b
     * "Decisions made this phase" #1: no per-node pipeline override yet, so
     * there is exactly one pipeline and, at most, this one meaningful
     * ceiling to compare it against). `null` when no Retrieve node exists in
     * the graph yet (a brand-new tenant, or one that hasn't added Retrieve).
     * Picking the *first* one mirrors this codebase's own repeated
     * "first X node is the canonical one for cross-cutting display"
     * convention (e.g. `reasoning.store.ts`'s `firstLlmNodeId`).
     */
    retrieveNodeBudgetMs: computed<number | null>(() => {
      const graph = draftConfig()?.reasoning?.graph ?? [];
      const node = graph.find((n): n is RetrieveNode => n.type === 'retrieve');
      return node?.budget_ms ?? null;
    }),
    /**
     * V-10 (`CONFIG_RETRIEVAL_BUDGET_EXCEEDED`) and V-9 (`KNOWLEDGE_SOURCE_STALE`)
     * — both attach to a `reasoning.graph`-layer error keyed by a Retrieve
     * node's id (not a source id, not a "stage" id, per the plan doc's
     * Phase 12b "Decisions made this phase" #5). This tab has exactly one
     * pipeline per tenant, so any error carrying either code is relevant
     * regardless of which node id it names — filtered by `code`, not by
     * `layer`/`field` node-id derivation (unlike `reasoning.store.ts`'s
     * `errorsByNode`, which this feature cannot import anyway —
     * `import/no-restricted-paths` forbids `knowledge` from reaching into
     * `features/reasoning/**`).
     */
    budgetExceededErrors: computed<ConfigErrorDto[]>(() =>
      (validateResult()?.errors ?? []).filter((error) => error.code === 'CONFIG_RETRIEVAL_BUDGET_EXCEEDED'),
    ),
    staleSourceErrors: computed<ConfigErrorDto[]>(() =>
      (validateResult()?.errors ?? []).filter((error) => error.code === 'KNOWLEDGE_SOURCE_STALE'),
    ),
  })),
  withMethods((store) => {
    const configApi = inject(DeploymentConfigApiService);

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
      // `reasoning.store.ts` had the identical bug, from the same copied
      // pattern, and are fixed the same way in this same phase.
      validateRequest$.pipe(debounceTime(VALIDATE_DEBOUNCE_MS)).subscribe(() => runValidate());
    }

    /** Applies a new `knowledge.pipeline` value to the draft, marks dirty, and schedules a debounced validate. */
    function setPipeline(pipeline: RetrievalPipelineConfig): void {
      const draft = store.draftConfig() ?? {};
      patchState(store, {
        draftConfig: { ...draft, knowledge: { ...draft.knowledge, pipeline } },
        dirty: true,
        saveAlert: null,
        conflict: false,
      });
      validateRequest$.next();
    }

    function loadFn(tenantId: string): void {
      wireDebounce();
      patchState(store, { ...initialState, tenantId, status: 'loading' });

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

      /** Replaces one stage of the six-stage pipeline — the Pipeline form's one edit primitive. */
      updateStage<K extends keyof RetrievalPipelineConfig>(stage: K, value: RetrievalPipelineConfig[K]): void {
        const pipeline = store.pipeline();
        if (!pipeline) {
          return;
        }
        setPipeline({ ...pipeline, [stage]: value });
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
