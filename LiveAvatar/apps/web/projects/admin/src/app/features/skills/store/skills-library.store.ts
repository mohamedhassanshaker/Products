import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type { CreateSkillRequest, SkillDto } from '@liveavatar/contracts';
import { SkillsApiService, type AppClientError } from '@liveavatar/web-shared';

interface SkillsLibraryState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: SkillDto[];
  /** Create/delete in flight — disables the "+ New skill" button and row actions. */
  mutating: boolean;
}

const initialState: SkillsLibraryState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  mutating: false,
};

/**
 * Skills library registry state (Skills tab, Phase 13, BL-049/050/051 —
 * `docs/v2/UX_SCOPE.md` "Skills tab"). Mirrors `ToolsStore`'s shape exactly
 * for the parts of a tenant-scoped CRUD registry this list page needs
 * (load/create/remove) — no agent-level attach/detach concept exists for
 * Skills (that's the Skill editor's own `tools[]`/graph-node routes, R-T1),
 * so this store is deliberately smaller than `ToolsStore`.
 */
export const SkillsLibraryStore = signalStore(
  { providedIn: 'root' },
  withState<SkillsLibraryState>(initialState),
  withMethods((store) => {
    const api = inject(SkillsApiService);

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

      create(body: CreateSkillRequest, onSuccess?: (skill: SkillDto) => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.create(tenantId, body).subscribe({
          next: (skill) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(skill);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      remove(skillId: string, onSuccess?: () => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.delete(tenantId, skillId).subscribe({
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
    };
  }),
);
