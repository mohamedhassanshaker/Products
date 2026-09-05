import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type { CreateHitlGateRequest, HitlGateDto, ReviewerGroupDto, UpdateHitlGateRequest } from '@liveavatar/contracts';
import { HitlApiService, type AppClientError } from '@liveavatar/web-shared';

interface HitlGatesState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: HitlGateDto[];
  /** Reviewer groups, for the gate dialog's `reviewer_group_id`/`escalate_to_group_id` pickers — loaded alongside the gate list rather than a separate store round-trip (mirrors `ReasoningStore` loading `tools`/`skills` for its own inspector pickers). */
  reviewerGroups: ReviewerGroupDto[];
  /** Create/update/delete in flight — disables the dialog's submit button and row actions. */
  mutating: boolean;
}

const initialState: HitlGatesState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  reviewerGroups: [],
  mutating: false,
};

/**
 * HITL gate registry state (HITL tab, Phase 14, BL-052..057 —
 * `docs/v2/UX_SCOPE.md` "HITL tab + Reviewer console"). Mirrors `ToolsStore`'s
 * shape for the parts a tenant-scoped CRUD registry needs (load/create/
 * update/remove).
 */
export const HitlGatesStore = signalStore(
  { providedIn: 'root' },
  withState<HitlGatesState>(initialState),
  withMethods((store) => {
    const api = inject(HitlApiService);

    function reloadList(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      api.listGates(tenantId).subscribe({
        next: (response) => patchState(store, { items: response.items, status: 'ready' }),
        error: (error: AppClientError) => patchState(store, { status: 'error', loadError: error }),
      });
    }

    return {
      load(tenantId: string): void {
        patchState(store, { ...initialState, tenantId, status: 'loading' });
        reloadList();
        api.listReviewerGroups(tenantId).subscribe({
          next: (response) => patchState(store, { reviewerGroups: response.items }),
          error: () => undefined,
        });
      },

      create(body: CreateHitlGateRequest, onSuccess?: (gate: HitlGateDto) => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.createGate(tenantId, body).subscribe({
          next: (gate) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(gate);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      update(
        gateId: string,
        body: UpdateHitlGateRequest,
        onSuccess?: (gate: HitlGateDto) => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.updateGate(tenantId, gateId, body).subscribe({
          next: (gate) => {
            patchState(store, { mutating: false });
            reloadList();
            onSuccess?.(gate);
          },
          error: (error: AppClientError) => {
            patchState(store, { mutating: false });
            onError?.(error);
          },
        });
      },

      remove(gateId: string, onSuccess?: () => void, onError?: (error: AppClientError) => void): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { mutating: true });
        api.deleteGate(tenantId, gateId).subscribe({
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
