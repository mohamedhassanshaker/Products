import type { AppErrorCode } from '@liveavatar/contracts';

/** One field/layer-level validation error surfaced by `validate`/`save` (FR-CONFIG-3/4). */
export interface ConfigError {
  code: AppErrorCode;
  layer?: string;
  field?: string;
  message: string;
  /**
   * Phase 12b (BL-045/047) — see `combination-rules.ts`'s
   * `knowledgeSourceNotStaleRule` and the plan doc's Phase 12b "Decisions
   * made this phase" #4. Optional; absent is treated as blocking (every
   * rule before this phase omits it and still blocks, unchanged).
   */
  severity?: 'error' | 'warning';
}
