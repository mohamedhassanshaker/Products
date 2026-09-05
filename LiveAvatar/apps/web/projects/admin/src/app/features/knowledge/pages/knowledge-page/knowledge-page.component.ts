import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { KnowledgeSourcesPageComponent } from '../knowledge-sources-page/knowledge-sources-page.component';
import { KnowledgePipelinePageComponent } from '../knowledge-pipeline-page/knowledge-pipeline-page.component';
import { KnowledgePlaygroundPageComponent } from '../knowledge-playground-page/knowledge-playground-page.component';

/**
 * Knowledge tab shell (Phase 12b, BL-045/047/048; `docs/v2/UX_SCOPE.md`
 * "Knowledge tab" — "Three sub-tabs under one 'Knowledge' tab (`mat-tab-group`
 * nested one level)"). Sources keeps its own full page (title, "Back to
 * Agent Builder" link, "+ New source" action) unchanged from Phase 12a —
 * mounted here exactly as it was mounted at the route directly before this
 * phase — so Pipeline and Playground follow the same "own header, own
 * back-link" convention every other builder tab page already uses rather
 * than introducing a second, competing shared header above the tab strip.
 * `mat-tab-group` handles APG tab semantics (arrow-key navigation, `role`
 * wiring) out of the box — no extra manual ARIA needed.
 */
@Component({
  selector: 'la-knowledge-page',
  standalone: true,
  imports: [MatTabsModule, KnowledgeSourcesPageComponent, KnowledgePipelinePageComponent, KnowledgePlaygroundPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-tab-group animationDuration="0ms">
      <mat-tab label="Sources">
        <la-knowledge-sources-page />
      </mat-tab>
      <mat-tab label="Pipeline">
        <la-knowledge-pipeline-page />
      </mat-tab>
      <mat-tab label="Playground">
        <la-knowledge-playground-page />
      </mat-tab>
    </mat-tab-group>
  `,
})
export class KnowledgePageComponent {}
