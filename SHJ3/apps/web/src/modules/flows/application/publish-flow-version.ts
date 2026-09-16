/**
 * Publish a flow version — B7's real "Save flow" action. Mirrors `modules/agents/
 * application/publish-agent-version.ts` structurally (see that file's own doc comment for
 * "why check `canPublish` before calling the repository").
 *
 * Deliberately does NOT check R3 (a condition node reachable from the entry node, the
 * flow's real free-text-escape guarantee) — that check needs `buildFlowCanvasModel`/
 * `hasFreeTextEscapePath`, which live under `apps/web/src/app/**`/`components/**`, and this
 * module may not import either (`eslint.config.mjs`'s `boundaries/element-types`: a feature
 * module may depend on `platform`/`components`/`shared`/itself, never `app`). The Server
 * Action calling this use case (`publishFlowVersionAction`, `agents/actions.ts`) checks R3
 * FIRST and never calls this use case at all when it fails — see that file's own doc
 * comment for the full sequencing.
 */

import { canPublishFlowVersion } from "../domain/flow-version.js";
import type { FlowRepository } from "../ports/flow-repository.js";

export interface PublishFlowVersionInput {
  readonly flowVersionId: string;
  readonly changeSummary: string | null;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type PublishFlowVersionResult =
  | { readonly ok: true; readonly label: string }
  | { readonly ok: false; readonly reason: "flows.already_published" }
  | { readonly ok: false; readonly reason: "flows.entry_node_required" }
  | { readonly ok: false; readonly reason: "flows.escape_node_required" };

export interface PublishFlowVersionDeps {
  readonly flows: FlowRepository;
}

export class PublishFlowVersion {
  constructor(private readonly deps: PublishFlowVersionDeps) {}

  async execute(input: PublishFlowVersionInput): Promise<PublishFlowVersionResult> {
    const { flows } = this.deps;

    const version = await flows.getFlowVersion(input.flowVersionId);
    if (!version) {
      throw new Error(
        `Cannot publish flow version "${input.flowVersionId}": no such version. ` +
          "Publishing acts on a version the Flow Designer already loaded, never an arbitrary id.",
      );
    }

    const check = canPublishFlowVersion(version.status);
    if (!check.allowed) {
      return { ok: false, reason: check.reason };
    }

    if (!version.entryNodeId) {
      return { ok: false, reason: "flows.entry_node_required" };
    }
    if (!version.escapeNodeId || !version.freeTextEscapeEnabled) {
      return { ok: false, reason: "flows.escape_node_required" };
    }

    return flows.publishVersion(input);
  }
}
