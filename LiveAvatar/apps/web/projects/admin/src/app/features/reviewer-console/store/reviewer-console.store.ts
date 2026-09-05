import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { interval } from 'rxjs';
import type { DecideHitlDecisionRequest, HitlDecisionDto, HitlGateDto } from '@liveavatar/contracts';
import { HitlApiService, type AppClientError } from '@liveavatar/web-shared';

/** Queue refetch cadence — "real-time-ish via the same short-poll mechanism the backend uses for decision delivery" (`docs/v2/UX_SCOPE.md` "HITL tab + Reviewer console", `ARCHITECTURE_NOTES.md` §6.2's ~1-2s agent-side poll; the console itself polls a little slower since it's a human-facing screen, not the turn-blocking path). No websocket needed for v1. */
const QUEUE_POLL_MS = 5000;

interface ReviewerConsoleState {
  tenantId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: AppClientError | null;
  items: HitlDecisionDto[];
  /** Every tenant gate, resolved once per `load()` — for the queue/detail panel's SLA-remaining display and gate-type/timeout-behavior context (a decision only carries `gate_id`, R-H6). */
  gates: HitlGateDto[];
  selectedId: string | null;
  /** A decide() call in flight — disables the Approve/Deny/Edit-and-approve buttons. */
  deciding: boolean;
  decideError: string | null;
}

const initialState: ReviewerConsoleState = {
  tenantId: null,
  status: 'idle',
  loadError: null,
  items: [],
  gates: [],
  selectedId: null,
  deciding: false,
  decideError: null,
};

/**
 * Reviewer console queue/decision state (Phase 14, BL-052..057 —
 * `docs/v2/UX_SCOPE.md` "HITL tab + Reviewer console", wireframe A8.5).
 * Polls `GET /tenants/:id/hitl/queue` on a ~5s interval rather than a
 * websocket, per the explicit v1 scope decision. Decisions call
 * `POST /tenants/:id/hitl/decisions/:id/decide` (UC-H1/UC-H2).
 */
export const ReviewerConsoleStore = signalStore(
  { providedIn: 'root' },
  withState<ReviewerConsoleState>(initialState),
  withMethods((store) => {
    const api = inject(HitlApiService);
    let pollWired = false;

    function reloadQueue(): void {
      const tenantId = store.tenantId();
      if (!tenantId) {
        return;
      }
      api.listQueue(tenantId).subscribe({
        next: (response) => {
          patchState(store, { items: response.items, status: 'ready' });
          // If the previously-selected decision left the queue (decided/timed
          // out elsewhere), drop the stale selection rather than showing a
          // detail panel for a row that's no longer pending.
          if (store.selectedId() && !response.items.some((d) => d.id === store.selectedId())) {
            patchState(store, { selectedId: null });
          }
        },
        error: (error: AppClientError) => patchState(store, { status: 'error', loadError: error }),
      });
    }

    function wirePolling(): void {
      if (pollWired) {
        return;
      }
      pollWired = true;
      interval(QUEUE_POLL_MS).subscribe(() => reloadQueue());
    }

    return {
      load(tenantId: string): void {
        wirePolling();
        patchState(store, { ...initialState, tenantId, status: 'loading' });
        reloadQueue();
        api.listGates(tenantId).subscribe({
          next: (response) => patchState(store, { gates: response.items }),
          error: () => undefined,
        });
      },

      refresh(): void {
        reloadQueue();
      },

      select(decisionId: string | null): void {
        patchState(store, { selectedId: decisionId, decideError: null });
      },

      decide(
        decisionId: string,
        body: DecideHitlDecisionRequest,
        onSuccess?: () => void,
        onError?: (error: AppClientError) => void,
      ): void {
        const tenantId = store.tenantId();
        if (!tenantId) {
          return;
        }
        patchState(store, { deciding: true, decideError: null });
        api.decide(tenantId, decisionId, body).subscribe({
          next: () => {
            patchState(store, { deciding: false, selectedId: null });
            reloadQueue();
            onSuccess?.();
          },
          error: (error: AppClientError) => {
            patchState(store, { deciding: false, decideError: error.message });
            onError?.(error);
          },
        });
      },
    };
  }),
);
