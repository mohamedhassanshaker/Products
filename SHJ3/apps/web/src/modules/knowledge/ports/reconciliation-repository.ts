/** `ReconciliationRuns` — §9.3's per-store, per-source drift comparison and its outcome. */

import type {
  ReconciliationRunState,
  ReconciliationScope,
  ReconciliationStore,
} from "../domain/knowledge-catalog.js";

export interface NewReconciliationRunInput {
  readonly store: ReconciliationStore;
  readonly scope: ReconciliationScope;
  readonly knowledgeSourceId: string | null;
  readonly startedAt: Date;
}

export interface CompleteReconciliationRunInput {
  readonly id: string;
  readonly expectedCount: number;
  readonly observedCount: number;
  readonly driftFound: number;
  readonly driftRepaired: number;
  readonly deadOutboxRequeued: number;
  readonly reindexJobId: string | null;
  readonly state: ReconciliationRunState;
  readonly finishedAt: Date;
}

export interface ReconciliationRunRow {
  readonly id: string;
  readonly store: ReconciliationStore;
  readonly scope: ReconciliationScope;
  readonly knowledgeSourceId: string | null;
  readonly expectedCount: number;
  readonly observedCount: number;
  readonly driftFound: number;
  readonly driftRepaired: number;
  readonly state: ReconciliationRunState;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface ReconciliationRepository {
  start(input: NewReconciliationRunInput): Promise<{ readonly id: string }>;
  complete(input: CompleteReconciliationRunInput): Promise<void>;
  list(): Promise<readonly ReconciliationRunRow[]>;
}
