/**
 * **The shared path.** Both the wizard's step 4 Server Actions and B5's Server Actions
 * call these exact same methods — that identity is what "binding in either place is
 * reflected in the other immediately" (`docs/api.md` §6.5) actually means, not a shared UI
 * control (B5 has none — see `tasks/todo.md`'s module-boundary note).
 */

import type { RequiredAssuranceLevel, ToolBindingTargetKind } from "../domain/tool-catalog.js";

export interface ToolBindingRow {
  readonly id: string;
  readonly agentVersionId: string;
  readonly targetKind: ToolBindingTargetKind;
  readonly skillId: string | null;
  readonly mcpToolId: string | null;
  readonly apiConnectorId: string | null;
  readonly isEnabled: boolean;
  readonly argumentPolicyJson: string | null;
  readonly requiredAssurance: RequiredAssuranceLevel;
  readonly rateLimitPolicyId: string | null;
  readonly boundByStaffUserId: string;
  readonly boundAt: Date;
}

/**
 * `reason` values translate `TR_ToolBindings_serverMustBeConnected`'s two THROW codes
 * (51120/51121, matched by SQL Server error number — see `domain/tool-catalog.ts`) into
 * the wire vocabulary `docs/api.md` documents nowhere near as precisely as the trigger
 * itself does, so this port's shape is the more authoritative of the two.
 */
export type BindToolResult =
  | { readonly ok: true; readonly binding: ToolBindingRow }
  | { readonly ok: false; readonly reason: "tools.server_not_connected" }
  | { readonly ok: false; readonly reason: "tools.target_soft_deleted" };

export interface ToolBindingRepository {
  listForVersion(agentVersionId: string): Promise<readonly ToolBindingRow[]>;

  /**
   * Upserts on the filtered unique `(agentVersionId, <targetKind's column>)`: a first bind
   * creates the row (`boundByStaffUserId`/`boundAt` = now/actor); re-binding an existing,
   * currently-disabled row flips `isEnabled` back to `true` **without** disturbing the
   * original `boundByStaffUserId`/`boundAt` — attribution is "who first granted this,"
   * not "who most recently toggled it."
   */
  bind(input: {
    readonly agentVersionId: string;
    readonly targetKind: ToolBindingTargetKind;
    readonly targetId: string;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<BindToolResult>;

  /** Sets `isEnabled = false` — never deletes the row, so binding history/attribution survives a later re-bind. */
  unbind(input: {
    readonly agentVersionId: string;
    readonly targetKind: ToolBindingTargetKind;
    readonly targetId: string;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "tools.binding_not_found" }
  >;

  /** B5's "per-agent attachment counts" (`docs/api.md` §6.5) — enabled-binding counts across every agent version, keyed by target id. Live queries, not a cache, which is what makes them "reflected immediately." */
  countEnabledBindingsBySkill(): Promise<ReadonlyMap<string, number>>;
  countEnabledBindingsByMcpTool(): Promise<ReadonlyMap<string, number>>;
  countEnabledBindingsByApiConnector(): Promise<ReadonlyMap<string, number>>;
}
