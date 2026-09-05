import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { SkillDto, SkillTriggerMode, TenantDto, ToolDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  PageHeaderComponent,
  TenantsApiService,
  TestCallPanelComponent,
  type AppClientError,
} from '@liveavatar/web-shared';
import { SkillEditorStore, type SkillEnvironment } from '../../store/skill-editor.store';
import { estimateTokens, utf8ByteLength } from '../../util/text-metrics';

/** `UpdateSkillDraftRequestSchema.instructions` maxLength (`packages/contracts/src/skills/schemas.ts`) — the UI cap mirrors it defensively, same as the system-prompt counter's own cap. */
const INSTRUCTIONS_BYTE_LIMIT = 32768;
/** `SkillVersionContentFields.description` maxLength. */
const DESCRIPTION_MAX_LENGTH = 500;
const ENVIRONMENTS: SkillEnvironment[] = ['dev', 'staging', 'production'];

/**
 * Skill editor (Skills tab, Phase 13, BL-049/050/051 — `docs/v2/UX_SCOPE.md`
 * "Skills tab", wireframe §A5.5). Full-page detail route off the library
 * (`/tenants/:id/builder/skills/:skillId` since Phase 16's builder shell),
 * autosaving to the draft `SkillVersion` via `SkillEditorStore`'s debounced
 * `patchDraft`.
 *
 * No "Extract from prompt" AI-assist button (BL-073 — explicitly out of
 * scope this phase) and no platform-library adoption affordance (BL-074,
 * n/a to this page anyway). The HITL section (Phase 14 follow-up, BL-052,
 * R-S6) is a real gate picker against this skill's own `hitl_gate_id`
 * field — attach/detach only; gate authoring itself happens in the HITL
 * tab (`features/hitl/`).
 */
@Component({
  selector: 'la-skill-editor-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    TestCallPanelComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-editor-page.component.html',
  styleUrl: './skill-editor-page.component.scss',
})
export class SkillEditorPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(SkillEditorStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly skillId = this.route.snapshot.paramMap.get('skillId') ?? '';
  readonly tenant = signal<TenantDto | null>(null);

  readonly instructionsByteLimit = INSTRUCTIONS_BYTE_LIMIT;
  readonly descriptionMaxLength = DESCRIPTION_MAX_LENGTH;
  readonly environments = ENVIRONMENTS;

  readonly descriptionTokenEstimate = computed(() => estimateTokens(this.store.draft()?.description ?? ''));
  readonly instructionsByteLength = computed(() => utf8ByteLength(this.store.draft()?.instructions ?? ''));
  readonly instructionsOverLimit = computed(() => this.instructionsByteLength() > INSTRUCTIONS_BYTE_LIMIT);

  readonly headerSubtitle = computed(() => {
    const skill = this.store.skill();
    if (!skill) {
      return undefined;
    }
    return skill.published_version ? `v${skill.published_version.version_number} published` : 'No published version yet';
  });

  /**
   * Local raw-text buffer for the comma-separated `source_refs` field —
   * seeded once from the loaded draft and never re-derived from the store
   * afterward, exactly the same reason `node-inspector.component.ts`'s own
   * `retrieveSourceRefs` signal is a free-typed buffer rather than a
   * `computed` join of the array: re-deriving `join(', ')` from the store on
   * every keystroke would normalize away an in-progress "a, " the instant
   * the debounced autosave echoes back, fighting the user's cursor.
   */
  private sourceRefsSeeded = false;
  readonly sourceRefsText = signal('');

  constructor() {
    effect(() => {
      const draft = this.store.draft();
      if (draft && !this.sourceRefsSeeded) {
        this.sourceRefsText.set(draft.knowledge_filters.source_refs.join(', '));
        this.sourceRefsSeeded = true;
      }
    });
  }

  ngOnInit(): void {
    if (!this.tenantId || !this.skillId) {
      void this.router.navigate(['/deployments']);
      return;
    }
    this.tenantsApi.get(this.tenantId).subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: () => undefined,
    });
    this.store.load(this.tenantId, this.skillId);
  }

  onName(name: string): void {
    this.store.patchDraft({ name });
  }

  onDescription(description: string): void {
    this.store.patchDraft({ description });
  }

  onInstructions(instructions: string): void {
    this.store.patchDraft({ instructions });
  }

  onTriggerMode(trigger_mode: SkillTriggerMode): void {
    this.store.patchDraft({ trigger_mode });
  }

  onBudgetMs(budget_ms: number): void {
    this.store.patchDraft({ budget_ms });
  }

  /** Phase 14 follow-up (BL-052, R-S6) — attach/detach this skill's own HITL gate. `''` from the "None" select option maps to `null` (no gate attached). */
  onHitlGateId(hitl_gate_id: string): void {
    this.store.patchDraft({ hitl_gate_id: hitl_gate_id || null });
  }

  isToolAttached(tool: ToolDto): boolean {
    return this.store.draft()?.tools.includes(tool.api_ref) ?? false;
  }

  toggleTool(tool: ToolDto): void {
    const draft = this.store.draft();
    if (!draft) {
      return;
    }
    const tools = this.isToolAttached(tool) ? draft.tools.filter((ref) => ref !== tool.api_ref) : [...draft.tools, tool.api_ref];
    this.store.patchDraft({ tools });
  }

  onSourceRefsChange(raw: string): void {
    this.sourceRefsText.set(raw);
    const current = this.store.draft()?.knowledge_filters ?? { source_refs: [] };
    const source_refs = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.store.patchDraft({ knowledge_filters: { ...current, source_refs } });
  }

  onTopK(top_k: number | null): void {
    const current = this.store.draft()?.knowledge_filters ?? { source_refs: [] };
    this.store.patchDraft({ knowledge_filters: { ...current, top_k: top_k ?? undefined } });
  }

  onMinScore(min_score: number | null): void {
    const current = this.store.draft()?.knowledge_filters ?? { source_refs: [] };
    this.store.patchDraft({ knowledge_filters: { ...current, min_score: min_score ?? undefined } });
  }

  isEnvEnabled(env: SkillEnvironment): boolean {
    return this.store.draft()?.environments.includes(env) ?? false;
  }

  toggleEnv(env: SkillEnvironment): void {
    const draft = this.store.draft();
    if (!draft) {
      return;
    }
    const environments = this.isEnvEnabled(env) ? draft.environments.filter((e) => e !== env) : [...draft.environments, env];
    this.store.patchDraft({ environments });
  }

  saveDraft(): void {
    this.store.saveDraft(
      () => this.snackBar.open('Draft saved.', 'Dismiss', { duration: 6000 }),
      () => this.snackBar.open('Could not save this draft. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  /** Fetches the live usage count and, only when the skill is actually attached to an agent, confirms before publishing (Reference file #6 — A5.3 UC-S2's pinned-version-warning spirit). Publishes immediately when `used_by_agent_count === 0`. */
  publish(): void {
    this.store.fetchUsage(
      (count) => {
        if (count === 0) {
          this.doPublish();
          return;
        }
        const name = this.store.draft()?.name ?? 'This skill';
        const ref = this.dialog.open(ConfirmDialogComponent, {
          width: '460px',
          data: {
            title: 'Publish this skill?',
            body: `"${name}" is used by ${count} agent(s). Publishing will change their behavior on their next config publish.`,
            confirmLabel: 'Publish',
          },
        });
        ref.afterClosed().subscribe((confirmed) => {
          if (confirmed) {
            this.doPublish();
          }
        });
      },
      () => this.snackBar.open('Could not check usage. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  private doPublish(): void {
    this.store.publish(
      (skill: SkillDto) =>
        this.snackBar.open(`Published v${skill.published_version?.version_number ?? ''}.`, 'Dismiss', { duration: 6000 }),
      (error: AppClientError) =>
        this.snackBar.open(error.message || 'Could not publish this skill. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  scrollToTest(): void {
    document.getElementById('la-skill-test-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  backToLibrary(): void {
    void this.router.navigate(['tenants', this.tenantId, 'skills']);
  }

  retry(): void {
    this.store.load(this.tenantId, this.skillId);
  }
}
