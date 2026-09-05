import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Subject, debounceTime } from 'rxjs';
import type {
  HitlGateDto,
  SkillDto,
  SkillKnowledgeFilter,
  SkillNode,
  SkillTriggerMode,
  ToolDto,
  UpdateSkillDraftRequest,
} from '@liveavatar/contracts';
import { HitlApiService, SkillsApiService, ToolsApiService, type AppClientError } from '@liveavatar/web-shared';

/** Debounce before autosaving to `PATCH /tenants/:id/skills/:skillId/draft` — same 400ms cadence `reasoning.store.ts` uses for its own debounced call (UX_GUIDELINES §10.2), applied here to the save itself rather than a validate call, since Skills have no Gate A/B validation endpoint to debounce against instead. */
const SAVE_DEBOUNCE_MS = 400;

/** `UpdateSkillDraftRequestSchema.environments` item union — not exported as its own named type from `packages/contracts`, so mirrored locally (same literal set). */
export type SkillEnvironment = 'dev' | 'staging' | 'production';
const ALL_ENVIRONMENTS: readonly SkillEnvironment[] = ['dev', 'staging', 'production'];

/** `SkillVersionDto.environments` is a loose `string[]` (server-side `Type.Array(Type.String())`, `packages/contracts/src/skills/schemas.ts`'s `SkillVersionSchema`) — narrowed defensively to the known literal set here rather than cast, so an unrecognized stored value is silently dropped instead of poisoning the draft's type. */
function toSkillEnvironments(values: readonly string[] | undefined): SkillEnvironment[] {
  if (!values) {
    return [...ALL_ENVIRONMENTS];
  }
  return values.filter((v): v is SkillEnvironment => (ALL_ENVIRONMENTS as readonly string[]).includes(v));
}

/** The editable fields of the current draft `SkillVersion`, plus `name` (which lives on the `Skill` row itself — see `UpdateSkillDraftRequestSchema`'s doc comment in `packages/contracts/src/skills/schemas.ts`). */
export interface SkillDraftFields {
  name: string;
  description: string;
  instructions: string;
  trigger_mode: SkillTriggerMode;
  tools: string[];
  knowledge_filters: SkillKnowledgeFilter;
  budget_ms: number;
  /** Phase 14 follow-up (BL-052, R-S6) — an optional `HitlGate` id this skill declares for itself. `null` means no gate attached (the common case). */
  hitl_gate_id: string | null;
  environments: SkillEnvironment[];
}

interface SkillEditorState {
  tenantId: string | null;
  skillId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
  loadError: AppClientError | null;
  skill: SkillDto | null;
  draft: SkillDraftFields | null;
  dirty: boolean;
  saving: boolean;
  /** Last autosave/manual-save HTTP failure message, shown as an inline banner (this store has no Gate A/B validation, so a plain HTTP error is the only failure mode to surface). */
  saveError: string | null;
  publishing: boolean;
  /** Tenant's tool registry, for the Tools attach checklist. */
  tools: ToolDto[];
  /** Phase 14 (BL-052/053) — every tenant HITL gate, for the "Human approval" section's gate picker. */
  gates: HitlGateDto[];
}

const initialState: SkillEditorState = {
  tenantId: null,
  skillId: null,
  status: 'idle',
  loadError: null,
  skill: null,
  draft: null,
  dirty: false,
  saving: false,
  saveError: null,
  publishing: false,
  tools: [],
  gates: [],
};

/** Seeds the editable draft fields from the `Skill`'s current draft version, falling back to the published version's content when no draft exists yet (a brand-new, never-edited-since-publish skill) — mirrors `UpdateSkillDraftRequestSchema`'s own "auto-forked from the published content if no draft exists yet" doc comment. */
function seedDraft(skill: SkillDto): SkillDraftFields {
  const version = skill.draft_version ?? skill.published_version;
  return {
    name: skill.name,
    description: version?.description ?? '',
    instructions: version?.instructions ?? '',
    trigger_mode: version?.trigger_mode ?? 'model',
    tools: version?.tools ?? [],
    knowledge_filters: version?.knowledge_filters ?? { source_refs: [] },
    budget_ms: version?.budget_ms ?? 1500,
    hitl_gate_id: version?.hitl_gate_id ?? null,
    environments: toSkillEnvironments(version?.environments),
  };
}

/**
 * Synthesizes a minimal, structurally-valid draft `AgentConfig` whose entire
 * `reasoning.graph` is one `skill`-type node referencing this skill under
 * test (id + `version: 'latest'`) — for the Test panel's
 * `POST /tenants/:id/config/test-call` call (Reference file #3 of this
 * phase's task brief). Every other top-level `AgentConfig` key is safely
 * omitted: `TestCallRequestSchema.config` is `Type.Unknown()`, and the
 * use-case (`test-call-graph.use-case.ts`) runs Gate A's schema check
 * against `DraftAgentConfigSchema` (`apps/api/.../domain/draft-schema.ts`),
 * whose every top-level branch is `T.Optional(...)` — so `{version, reasoning}`
 * alone passes Gate A and reaches the real simulator, exactly like a
 * brand-new tenant's placeholder config does elsewhere in this codebase.
 *
 * **This is a structural simulation only** (same limitation the Reasoning
 * tab's own Test-call panel already carries, and the same one Retrieve's
 * stub carries): the Skill node's simulator branch never fetches this
 * skill's real body (`GET /internal/skills/{id}/versions/{version}/body` is
 * agent-facing only), so it can never reflect unsaved instruction edits
 * live. This is not a gap to fix — see `TestCallGraphUseCase.runNode`'s
 * `case 'skill'` doc comment for the backend side of the same statement.
 */
function buildTestConfig(skillId: string, budgetMs: number): unknown {
  const node: SkillNode = {
    id: 'skill_under_test',
    name: 'Skill under test',
    lane: 'foreground',
    on_error: { action: 'end_turn' },
    on_deadline: { action: 'end_turn' },
    type: 'skill',
    skill_id: skillId,
    version: 'latest',
    budget_ms: budgetMs,
    next_node_id: null,
  };
  return {
    version: 1,
    reasoning: {
      graph: [node],
      entry_node_id: node.id,
      background_entry_node_ids: [],
      turn_budget_ms: Math.max(3000, budgetMs),
    },
  };
}

/**
 * Skill editor working-draft state (Skills tab, Phase 13, BL-049/050/051).
 * Mirrors `reasoning.store.ts`'s debounced-save/dirty shape (a `Subject` +
 * `debounceTime` + `distinctUntilChanged`, ~400ms) rather than
 * `ToolsStore`'s dialog-only CRUD, since the Skill editor is a full detail
 * route with autosave-to-draft semantics (`UX_SCOPE.md`). Unlike
 * `ReasoningStore`, there is no Gate A/B validation to debounce (no
 * `POST /config/validate`-equivalent for skills) — the debounce here drives
 * the autosave `PATCH` call itself.
 */
export const SkillEditorStore = signalStore(
  { providedIn: 'root' },
  withState<SkillEditorState>(initialState),
  withComputed(({ skill, draft }) => ({
    /** Publish is only meaningful while a draft version exists — a `Skill` with no draft has nothing newer than what is already published (R-S3). */
    canPublish: computed(() => (skill()?.draft_version ?? null) !== null),
    /** The version number a successful publish would create — `current published + 1`, or `1` for a never-published skill. */
    nextVersionNumber: computed(() => (skill()?.published_version?.version_number ?? 0) + 1),
    /** Minimal single-skill-node draft config for the embedded `<la-test-call-panel>` — see `buildTestConfig`'s doc comment. */
    testConfig: computed(() => {
      const id = skill()?.id;
      if (!id) {
        return null;
      }
      return buildTestConfig(id, draft()?.budget_ms ?? 1500);
    }),
  })),
  withMethods((store) => {
    const skillsApi = inject(SkillsApiService);
    const toolsApi = inject(ToolsApiService);
    const hitlApi = inject(HitlApiService);

    const saveRequest$ = new Subject<void>();
    let debounceWired = false;

    function performSave(onSuccess?: (skill: SkillDto) => void, onError?: (error: AppClientError) => void): void {
      const tenantId = store.tenantId();
      const skillId = store.skillId();
      const draft = store.draft();
      if (!tenantId || !skillId || !draft) {
        return;
      }
      patchState(store, { saving: true, saveError: null });
      const body: UpdateSkillDraftRequest = { ...draft };
      skillsApi.updateDraft(tenantId, skillId, body).subscribe({
        next: (skill) => {
          patchState(store, { saving: false, dirty: false, skill });
          onSuccess?.(skill);
        },
        error: (error: AppClientError) => {
          patchState(store, { saving: false, saveError: error.message });
          onError?.(error);
        },
      });
    }

    function wireDebounce(): void {
      if (debounceWired) {
        return;
      }
      debounceWired = true;
      // Deliberately `debounceTime` only, no `distinctUntilChanged`.
      // Empirically verified (standalone RxJS repro) that on a
      // `Subject<void>` source every debounced emission carries the same
      // value (`undefined`), so `distinctUntilChanged`'s default `===`
      // comparator treats every emission after the very first as a
      // duplicate and silently drops it — for the lifetime of this
      // `providedIn: 'root'` singleton, autosave would fire exactly once
      // per browser tab and never again. Since this store's whole purpose
      // is repeated autosaving across many separate edit bursts, that
      // operator is omitted here rather than copied. This finding was
      // traced back to the same otherwise-identical pattern in
      // `reasoning.store.ts`, `agent-builder.store.ts`, and
      // `knowledge-pipeline.store.ts` — all three had the identical bug
      // and are fixed the same way, in this same phase.
      saveRequest$.pipe(debounceTime(SAVE_DEBOUNCE_MS)).subscribe(() => performSave());
    }

    return {
      load(tenantId: string, skillId: string): void {
        wireDebounce();
        patchState(store, { ...initialState, tenantId, skillId, status: 'loading' });

        toolsApi.list(tenantId).subscribe({
          next: (response) => patchState(store, { tools: response.items }),
          error: () => undefined,
        });
        hitlApi.listGates(tenantId).subscribe({
          next: (response) => patchState(store, { gates: response.items }),
          error: () => undefined,
        });

        skillsApi.get(tenantId, skillId).subscribe({
          next: (skill) => patchState(store, { status: 'ready', skill, draft: seedDraft(skill), dirty: false }),
          error: (error: AppClientError) =>
            patchState(store, { status: error.code === 'SKILL_NOT_FOUND' ? 'not_found' : 'error', loadError: error }),
        });
      },

      /** Applies a field-level patch to the working draft, marks it dirty, and schedules the debounced autosave. */
      patchDraft(patch: Partial<SkillDraftFields>): void {
        const current = store.draft();
        if (!current) {
          return;
        }
        patchState(store, { draft: { ...current, ...patch }, dirty: true });
        saveRequest$.next();
      },

      /** "Save draft" button — flushes immediately rather than waiting for the debounce, e.g. right before navigating away. */
      saveDraft(onSuccess?: (skill: SkillDto) => void, onError?: (error: AppClientError) => void): void {
        performSave(onSuccess, onError);
      },

      publish(onSuccess?: (skill: SkillDto) => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        const skillId = store.skillId();
        if (!tenantId || !skillId) {
          return;
        }
        patchState(store, { publishing: true });
        skillsApi.publish(tenantId, skillId).subscribe({
          next: (response) => {
            patchState(store, { publishing: false, skill: response.skill, draft: seedDraft(response.skill), dirty: false });
            onSuccess?.(response.skill);
          },
          error: (error: AppClientError) => {
            patchState(store, { publishing: false });
            onError?.(error);
          },
        });
      },

      /** `GET /tenants/:id/skills/:skillId/usage` — the pre-publish "used by N agents" check (A5.3 UC-S2). Fetched on demand right before the publish confirm, never cached, since it can change between visits. */
      fetchUsage(onResult: (count: number) => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        const skillId = store.skillId();
        if (!tenantId || !skillId) {
          return;
        }
        skillsApi.usage(tenantId, skillId).subscribe({
          next: (response) => onResult(response.used_by_agent_count),
          error: (error: AppClientError) => onError?.(error),
        });
      },
    };
  }),
);
