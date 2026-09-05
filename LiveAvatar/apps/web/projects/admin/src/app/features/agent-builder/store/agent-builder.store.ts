import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { Subject, debounceTime } from 'rxjs';
import { parse as parseYaml } from 'yaml';
import type {
  ConfigErrorDto,
  ProviderCredentialDto,
  ProviderDefinitionDto,
  ValidateConfigResponseDto,
} from '@liveavatar/contracts';
import {
  DeploymentConfigApiService,
  ProvidersApiService,
  TenantsApiService,
  type AppClientError,
} from '@liveavatar/web-shared';
import { defaultDynamics, emptyDraft, type AgentConfigDraft } from './agent-config-draft.model';

/** Debounce before re-running `POST /config/validate` on every edit (UX_GUIDELINES §10.2). */
const VALIDATE_DEBOUNCE_MS = 400;

interface AgentBuilderState {
  tenantId: string | null;
  tenantName: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  configStatus: 'draft' | 'published' | null;
  /** ISO `updated_at` — doubles as the `If-Match` token (LLD §8.6). */
  ifMatch: string | null;
  /** Last-published YAML, used only to detect "unpublished changes" divergence. */
  publishedYamlText: string | null;
  draft: AgentConfigDraft;
  dirty: boolean;
  definitions: ProviderDefinitionDto[];
  credentials: ProviderCredentialDto[];
  validating: boolean;
  validateResult: ValidateConfigResponseDto | null;
  saving: 'draft' | 'published' | null;
  saveAlert: string | null;
  conflict: boolean;
}

const initialState: AgentBuilderState = {
  tenantId: null,
  tenantName: '',
  status: 'idle',
  loadError: null,
  configStatus: null,
  ifMatch: null,
  publishedYamlText: null,
  draft: emptyDraft(),
  dirty: false,
  definitions: [],
  credentials: [],
  validating: false,
  validateResult: null,
  saving: null,
  saveAlert: null,
  conflict: false,
};

/**
 * Agent Builder working-draft state (Screen 2, LLD §9.1). Owns the
 * structured draft, its debounced validate result, and the redacted YAML
 * preview (`validateResult.redacted_yaml`).
 */
export const AgentBuilderStore = signalStore(
  { providedIn: 'root' },
  withState<AgentBuilderState>(initialState),
  withComputed(({ configStatus, dirty, draft, publishedYamlText, validateResult }) => ({
    /** Publish is structurally impossible while the last validate result is invalid (UX_GUIDELINES §10.8). */
    canPublish: computed(() => validateResult()?.valid === true),
    /** UX_GUIDELINES §10.3 "Published, with unpublished changes" indicator. */
    hasUnpublishedChanges: computed(() => configStatus() === 'published' && dirty() && publishedYamlText() !== null),
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
    /**
     * Phase 16 (BL-062) — `dynamics.*` fields have no combination rule of
     * their own to set a `layer` (unlike `stt`/`tts`/`avatar`/`transport`,
     * see `combination-rules.ts`'s `selections` array), so a Gate A
     * structural error against one of these fields (e.g. an out-of-range
     * `endpointing_silence_ms`) carries only a JSON-Pointer `field`
     * (`/dynamics/endpointing_silence_ms`), no `layer`
     * (`validate-config.use-case.ts`'s schema-gate loop). Grouped by `field`
     * so the Dynamics tab can still show it inline at the right control.
     */
    errorsByField: computed(() => {
      const map = new Map<string, ConfigErrorDto[]>();
      for (const error of validateResult()?.errors ?? []) {
        if (!error.field) {
          continue;
        }
        const list = map.get(error.field) ?? [];
        list.push(error);
        map.set(error.field, list);
      }
      return map;
    }),
    /** `draft().dynamics`, or the schema's own defaults when the tenant's config has never had this block set (see `dynamics.schema.ts`'s doc comment on why it's optional). */
    dynamics: computed(() => draft().dynamics ?? defaultDynamics()),
  })),
  withMethods((store) => {
    const deploymentConfigApi = inject(DeploymentConfigApiService);
    const providersApi = inject(ProvidersApiService);
    const tenantsApi = inject(TenantsApiService);

    const validateRequest$ = new Subject<void>();
    let debounceWired = false;

    function runValidate(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      patchState(store, { validating: true });
      deploymentConfigApi.validate(tenantId, { config: store.draft() }).subscribe({
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
      // bug found and fixed in Phase 13 (BL-049/050/051), discovered while
      // building the Skills tab's own debounced-save store and traced back
      // to this file, the original source of the copied pattern:
      // `validateRequest$` is a `Subject<void>`, so every emission carries
      // the same value (`undefined`). `distinctUntilChanged`'s default
      // `===` comparator therefore treats every emission after the very
      // first as a duplicate and silently drops it, meaning
      // `runValidate()` fired only once per store instance (once per tab,
      // ever) — every edit burst after the first never re-validated.
      // Verified with a standalone RxJS repro before fixing.
      // `reasoning.store.ts` and `knowledge-pipeline.store.ts` had the
      // identical bug and are fixed the same way in this same phase.
      validateRequest$.pipe(debounceTime(VALIDATE_DEBOUNCE_MS)).subscribe(() => runValidate());
    }

    /**
     * Loads tenant name, structured config, catalog, and tenant credentials,
     * then hydrates the draft and runs an initial validate (UX_GUIDELINES
     * §10.2 steps 2–4). Named as a plain closure (not a method on the
     * returned object) so `reloadAfterConflict` can call it directly rather
     * than relying on a `this` binding through the store's merged methods.
     * @param tenantId - Path tenant id
     */
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

        deploymentConfigApi.get(tenantId).subscribe({
          next: (config) => {
            let hydrated: AgentConfigDraft = emptyDraft();
            if (config.yaml_text) {
              try {
                hydrated = { ...emptyDraft(), ...(parseYaml(config.yaml_text) as AgentConfigDraft) };
              } catch {
                hydrated = emptyDraft();
              }
            }
            patchState(store, {
              status: 'ready',
              configStatus: config.status,
              ifMatch: config.updated_at,
              publishedYamlText: config.status === 'published' ? config.yaml_text : null,
              draft: hydrated,
              dirty: false,
            });
            runValidate();
          },
          error: (error: AppClientError) => patchState(store, { status: 'error', loadError: error }),
        });
    }

    return {
      load: loadFn,

      /**
       * Shallow-merges a patch into the current draft (each caller passes
       * the full sub-object it owns, e.g. `{ stt: { ...current, provider } }`)
       * and schedules a debounced validate.
       * @param patch - Partial draft to merge at the top level
       */
      patchDraft(patch: Partial<AgentConfigDraft>): void {
        patchState(store, { draft: { ...store.draft(), ...patch }, dirty: true, saveAlert: null, conflict: false });
        validateRequest$.next();
      },

      /**
       * Save the current draft (`save_as: draft`) — persists even if
       * incomplete/invalid (FR-CONFIG-3). `onSuccess` fires only after the
       * server confirms the write, so a caller's toast never lies about
       * whether the save actually happened.
       * @param onSuccess - Called once the save resolves without error
       */
      saveDraft(onSuccess?: () => void): void {
        save('draft', onSuccess);
      },

      /**
       * Publish the current draft (`save_as: published`) — only reachable
       * when `canPublish()`.
       * @param onSuccess - Called once the publish resolves without error
       */
      publish(onSuccess?: () => void): void {
        save('published', onSuccess);
      },

      /**
       * Re-fetches the latest config after a `409 CONFIG_CONFLICT`,
       * discarding the local draft (UX_GUIDELINES §10.3 conflict state).
       */
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
      if (!tenantId || !ifMatch) {
        return;
      }
      patchState(store, { saving: saveAs, saveAlert: null });
      deploymentConfigApi.save(tenantId, { config: store.draft(), save_as: saveAs }, ifMatch).subscribe({
        next: (config) => {
          patchState(store, {
            saving: null,
            configStatus: config.status,
            ifMatch: config.updated_at,
            publishedYamlText: config.status === 'published' ? config.yaml_text : store.publishedYamlText(),
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
