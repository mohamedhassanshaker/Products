import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AgentBuilderStore } from '../../store/agent-builder.store';
// Phase 16 (BL-061, `docs/v2/UX_SCOPE.md` "Overview: read-only composition
// of the other 7 tabs' already-built state... no new logic") — these
// cross-feature imports are the one ESLint feature-isolation exemption this
// phase adds (`eslint.config.mjs`'s `BUILDER_COMPOSED_FEATURES`), because
// composing them is this tab's entire job. Every store below is
// `providedIn: 'root'` and otherwise reached only from its own feature's
// pages; Overview injects each directly rather than duplicating their
// fetch/store logic.
import { ReasoningStore } from '../../../reasoning/store/reasoning.store';
import { ToolsStore } from '../../../tools/store/tools.store';
import { SkillsLibraryStore } from '../../../skills/store/skills-library.store';
import { KnowledgeSourcesStore } from '../../../knowledge/store/knowledge-sources.store';
import { HitlGatesStore } from '../../../hitl/store/hitl-gates.store';
import { estimateTokens } from '../../token-estimate.util';

/**
 * Overview tab (Phase 16, BL-061 — `docs/v2/UX_SCOPE.md`). The builder's
 * landing view: four read-only summary cards (Media Pipeline, Reasoning,
 * Capabilities, Behaviour) per A9.2's wireframe, each with an `[edit ▸]`
 * link into the relevant tab. Deliberately has **no store of its own** — it
 * injects the six other tabs' already-`providedIn: 'root'` stores directly
 * and reads their existing signals, per the phase's explicit "no new logic"
 * framing. The one thing it *does* do that those stores don't already do
 * for it is call `.load(tenantId)` on the five it doesn't share with the
 * shell (`ReasoningStore`/`ToolsStore`/`SkillsLibraryStore`/
 * `KnowledgeSourcesStore`/`HitlGatesStore`) — guarded on `tenantId()`
 * already matching, so landing here after having *already* visited (and
 * possibly dirtied) one of those tabs doesn't clobber it. `AgentBuilderStore`
 * is not re-loaded here: the shell already loads it once on mount, and
 * every other Gate A/B error in the whole document (tools/skills/knowledge/
 * hitl included, not just transport/stt/tts/avatar/dynamics) already flows
 * through its one `validateResult()`, because `/config/validate` validates
 * the entire document in one call — see `ValidateConfigUseCase.execute`.
 *
 * Two things this card set deliberately omits, both already resolved in the
 * phase brief rather than gaps: the "via skills / via graph node" tool
 * breakdown and a numeric skill base-prompt-cost split (neither is computed
 * anywhere client-side today — building it would be new logic, which this
 * tab is explicitly not meant to add), and "Greeting" in the Behaviour card
 * (no such field exists anywhere in the schema).
 *
 * Loading these five stores (`.load(tenantId)`) is `BuilderShellComponent`'s
 * job, not this component's: the persistent right rail needs the same data
 * regardless of which tab is active, including a deep link straight to e.g.
 * Dynamics that never mounts this component at all, so the always-mounted
 * shell — not one-of-nine-tabs Overview — owns triggering those loads.
 */
@Component({
  selector: 'la-overview-tab',
  standalone: true,
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview-tab.component.html',
  styleUrls: ['../builder-shared.scss'],
})
export class OverviewTabComponent {
  private readonly route = inject(ActivatedRoute);
  readonly builder = inject(AgentBuilderStore);
  readonly reasoning = inject(ReasoningStore);
  readonly tools = inject(ToolsStore);
  readonly skills = inject(SkillsLibraryStore);
  readonly knowledge = inject(KnowledgeSourcesStore);
  readonly hitl = inject(HitlGatesStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';

  // --- Media Pipeline card ---------------------------------------------
  readonly pipelineRows = computed(() => {
    const resolved = this.builder.validateResult()?.resolved ?? {};
    return (['transport', 'stt', 'tts', 'avatar'] as const).map((layer) => ({
      layer,
      provider: resolved[layer]?.provider ?? null,
    }));
  });

  // --- Reasoning card -----------------------------------------------------
  readonly reasoningNodeCount = computed(() => this.reasoning.reasoning()?.graph.length ?? 0);
  readonly reasoningEntryNode = computed(() => {
    const graph = this.reasoning.reasoning();
    if (!graph) {
      return null;
    }
    return graph.graph.find((n) => n.id === graph.entry_node_id)?.name ?? graph.entry_node_id;
  });

  // --- Capabilities card ----------------------------------------------
  readonly skillsCount = computed(() => this.skills.items().length);
  readonly skillsTokenEstimate = computed(() =>
    this.skills.items().reduce((sum, skill) => {
      const version = skill.published_version ?? skill.draft_version;
      return sum + estimateTokens(skill.name + (version?.description ?? ''));
    }, 0),
  );

  readonly attachedToolsCount = computed(() => this.tools.attachedRefs().size);
  readonly consequentialToolsCount = computed(() => this.tools.items().filter((t) => t.consequential).length);
  readonly consequentialUngatedCount = computed(
    () => (this.builder.validateResult()?.errors ?? []).filter((e) => e.code === 'CONFIG_CONSEQUENTIAL_TOOL_UNGATED').length,
  );

  readonly knowledgeSourceCount = computed(() => this.knowledge.items().length);
  readonly knowledgeChunkCount = computed(() => this.knowledge.items().reduce((sum, s) => sum + (s.chunk_count ?? 0), 0));
  readonly staleKnowledgeCount = computed(() => this.knowledge.items().filter((s) => s.is_stale).length);

  readonly hitlGateCount = computed(() => this.hitl.items().length);
  readonly hitlUncoveredCount = computed(
    () => (this.builder.validateResult()?.errors ?? []).filter((e) => e.code === 'HITL_REVIEWER_COVERAGE_MISSING').length,
  );

  // --- Behaviour card -----------------------------------------------------
  readonly dynamics = computed(() => this.builder.dynamics());
  readonly sttLanguage = computed(() => this.builder.draft().stt?.language ?? null);
}
