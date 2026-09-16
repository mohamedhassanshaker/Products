/**
 * Bind a tool to an agent version — **the shared path**.
 *
 * Both the agent wizard's step-4 Server Action and B5's own Server Action must
 * construct and call this exact class (not two different code paths, and never
 * `ToolBindingRepository.bind` directly from either route) for "binding in
 * either place is reflected in the other immediately" (`docs/api.md` §6.5) to be
 * true. There is deliberately no logic in this use case beyond the passthrough —
 * `ToolBindingRepository.bind`'s own doc comment owns the upsert semantics
 * (first bind creates the row; re-binding a currently-disabled row flips
 * `isEnabled` back on without disturbing original attribution) and the
 * trigger-rejection translation (`tools.server_not_connected` /
 * `tools.target_soft_deleted`, from `TR_ToolBindings_serverMustBeConnected`).
 * Adding a second implementation of any of that here would be a second place
 * those rules could drift out of sync with what the port actually enforces.
 */

import type { RequiredAssuranceLevel, ToolBindingTargetKind } from "../domain/tool-catalog.js";
import type { BindToolResult, ToolBindingRepository } from "../ports/tool-binding-repository.js";

export interface BindToolInput {
  readonly agentVersionId: string;
  readonly targetKind: ToolBindingTargetKind;
  readonly targetId: string;
  readonly requiredAssurance: RequiredAssuranceLevel;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export interface BindToolDeps {
  readonly bindings: ToolBindingRepository;
}

export class BindTool {
  constructor(private readonly deps: BindToolDeps) {}

  async execute(input: BindToolInput): Promise<BindToolResult> {
    return this.deps.bindings.bind(input);
  }
}
