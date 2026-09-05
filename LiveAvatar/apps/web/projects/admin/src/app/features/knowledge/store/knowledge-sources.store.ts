import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type {
  CreateKnowledgeSourceRequest,
  KnowledgeSourceDto,
  ReindexEstimateResponseDto,
  UpdateKnowledgeSourceRequest,
} from '@liveavatar/contracts';
import { KnowledgeSourcesApiService, type AppClientError } from '@liveavatar/web-shared';

interface KnowledgeSourcesState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: KnowledgeSourceDto[];
  /** Create/update/delete in flight — disables row actions and the dialog's submit button. */
  mutating: boolean;
  /** Source id currently running a reindex-estimate or trigger-reindex call, or null. */
  reindexingId: string | null;
}

const initialState: KnowledgeSourcesState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  mutating: false,
  reindexingId: null,
};

/** @param err - Unknown thrown value from an HttpClient observable (already unwrapped by `errorEnvelopeInterceptor`). */
function asClientError(err: unknown): AppClientError {
  if (err && typeof err === 'object' && 'code' in err) {
    return err as AppClientError;
  }
  return { status: 0, code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.', details: {} };
}

/**
 * Knowledge-source registry CRUD + re-index preview/confirm state (Phase
 * 12a RAG ingestion, `docs/plans/agent-builder-v2-plan.md`). Mirrors
 * `ToolsStore`'s callback-based CRUD vocabulary exactly; `estimateReindex`/
 * `triggerReindex` are `async`/`Promise`-returning (the `firstValueFrom`
 * convention already used by `call-session.store.ts`) so the page component
 * can `await` the estimate before opening the confirm dialog, and only then
 * `await` the trigger.
 */
export const KnowledgeSourcesStore = signalStore(
  { providedIn: 'root' },
  withState<KnowledgeSourcesState>(initialState),
  withMethods((store) => {
    const api = inject(KnowledgeSourcesApiService);

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

    return {
      load(tenantId: string): void {
        patchState(store, { ...initialState, tenantId, status: 'loading' });
        reloadList();
      },

      create(
        fields: CreateKnowledgeSourceRequest,
        file: File,
        onSuccess?: (source: KnowledgeSourceDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.create(tenantId, fields, file).subscribe({
          next: (source) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(source);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      update(
        sourceId: string,
        body: UpdateKnowledgeSourceRequest,
        ifMatch: string,
        onSuccess?: (source: KnowledgeSourceDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.update(tenantId, sourceId, body, ifMatch).subscribe({
          next: (source) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(source);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      remove(sourceId: string, onSuccess?: () => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.delete(tenantId, sourceId).subscribe({
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

      /**
       * `GET .../reindex-estimate` — a side-effect-free preview computed
       * fresh from the source's *current* config (plan doc "Decisions made
       * this phase" #8), never persisted locally beyond the in-flight flag.
       */
      async estimateReindex(sourceId: string): Promise<ReindexEstimateResponseDto> {
        const tenantId = store.tenantId();
        if (!tenantId) {
          throw asClientError({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'No tenant loaded.', status: 404, details: {} });
        }
        patchState(store, { reindexingId: sourceId });
        try {
          return await firstValueFrom(api.estimateReindex(tenantId, sourceId));
        } catch (err) {
          throw asClientError(err);
        } finally {
          patchState(store, { reindexingId: null });
        }
      },

      /**
       * `POST .../reindex` — actually enqueues the job, then reloads the
       * list so the UI reflects the new `pending`/`processing` status.
       */
      async triggerReindex(sourceId: string): Promise<void> {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { reindexingId: sourceId });
        try {
          await firstValueFrom(api.triggerReindex(tenantId, sourceId));
          reloadList();
        } catch (err) {
          throw asClientError(err);
        } finally {
          patchState(store, { reindexingId: null });
        }
      },
    };
  }),
);
