/** A tool's execution lane (R-T3) — a `background` tool never blocks speech. */
export type ToolLane = 'foreground' | 'background';

/**
 * `ToolDefinition` aggregate (LLD §4.3, FR-AGENT-2/5) as the application
 * layer sees it. Extended in Phase 8 (BL-033, `docs/v2/BACKLOG.md`) with
 * `consequential`/`lane`/`perSessionCap`/`perTurnCap`/`timeoutMs`/
 * `requiresCredential` — see `docs/plans/agent-builder-v2-plan.md`.
 */
export interface ToolDefinitionRecord {
  id: string;
  tenantId: string;
  apiRef: string;
  name: string;
  description: string | null;
  method: string;
  url: string;
  credentialRef: string | null;
  requiresCredential: boolean;
  argsSchema: Record<string, unknown>;
  enabled: boolean;
  consequential: boolean;
  /** Phase 14 (BL-057, V-6) — a written opt-out of HITL gating for this consequential tool. */
  autonomousUseAckText: string | null;
  lane: ToolLane;
  perSessionCap: number | null;
  perTurnCap: number | null;
  timeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}
