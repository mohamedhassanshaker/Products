/** Read-shape returned for every level of the FR-TAX-1 hierarchy. */
export interface EducationLevelSummary {
  id: number;
  name: string;
  createdAt: Date;
}

/** Read-shape for a `stage`, always scoped under one `educationLevelId` (FR-TAX-3: Exam Types,
 * Curricula, and generated content are scoped to a Stage/Subject — `educationLevelId` is what lets a
 * client render the hierarchy without a second lookup). */
export interface StageSummary {
  id: number;
  educationLevelId: number;
  name: string;
  createdAt: Date;
}

/** Read-shape for a `subject`, always scoped under one `stageId`. */
export interface SubjectSummary {
  id: number;
  stageId: number;
  name: string;
  createdAt: Date;
}

/** Result of a create-or-fetch call (FR-TAX-2). `created` drives the Route Handler's 201-vs-200
 * status-code choice — the service layer decides this, not the route, since it is the layer that
 * actually knows whether the row it is returning was just inserted or already existed. */
export interface CreateOrFetchResult<T> {
  entity: T;
  created: boolean;
}
