/**
 * Unbind a tool from an agent version — the other half of **the shared path**
 * (see `bind-tool.ts`'s own doc comment). Both the wizard's step 4 and B5's own
 * Server Actions call this exact class.
 *
 * `ToolBindingRepository.unbind`'s own doc comment owns the semantics: sets
 * `isEnabled = false` and never deletes the row, so binding history and original
 * attribution survive a later re-bind.
 */

import type { ToolBindingTargetKind } from "../domain/tool-catalog.js";
import type { ToolBindingRepository } from "../ports/tool-binding-repository.js";

export interface UnbindToolInput {
  readonly agentVersionId: string;
  readonly targetKind: ToolBindingTargetKind;
  readonly targetId: string;
}

export type UnbindToolResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "tools.binding_not_found" };

export interface UnbindToolDeps {
  readonly bindings: ToolBindingRepository;
}

export class UnbindTool {
  constructor(private readonly deps: UnbindToolDeps) {}

  async execute(input: UnbindToolInput): Promise<UnbindToolResult> {
    return this.deps.bindings.unbind(input);
  }
}
