import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type { CreateReviewerGroupRequest, ReviewerGroupDto, UpdateReviewerGroupRequest } from '@liveavatar/contracts';
import { HitlApiService, type AppClientError } from '@liveavatar/web-shared';

interface ReviewerGroupsState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: ReviewerGroupDto[];
  /** Create/update/delete in flight — disables the dialog's submit button and row actions. */
  mutating: boolean;
}

const initialState: ReviewerGroupsState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  mutating: false,
};

/**
 * Reviewer group registry state (HITL tab's reviewer-group management
 * section, Phase 14, BL-052..057). Mirrors `SkillsLibraryStore`'s shape
 * exactly for a small tenant-scoped CRUD registry (load/create/update/
 * remove) — no agent-level attach/detach concept exists for reviewer
 * groups (they're referenced by id from a `HitlGate`, R-H1).
 */
export const ReviewerGroupsStore = signalStore(
  { providedIn: 'root' },
  withState<ReviewerGroupsState>(initialState),
  withMethods((store) => {
    const api = inject(HitlApiService);

    function reloadList(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      api.listReviewerGroups(tenantId).subscribe({
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
        body: CreateReviewerGroupRequest,
        onSuccess?: (group: ReviewerGroupDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.createReviewerGroup(tenantId, body).subscribe({
          next: (group) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(group);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      update(
        groupId: string,
        body: UpdateReviewerGroupRequest,
        onSuccess?: (group: ReviewerGroupDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.updateReviewerGroup(tenantId, groupId, body).subscribe({
          next: (group) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(group);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      remove(groupId: string, onSuccess?: () => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.deleteReviewerGroup(tenantId, groupId).subscribe({
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
