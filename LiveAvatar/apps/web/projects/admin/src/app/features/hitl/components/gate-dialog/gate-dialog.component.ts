import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  SUPPORTED_HITL_GATE_TYPES,
  type HitlAttachmentKind,
  type HitlGateDto,
  type HitlGateType,
  type HitlTimeoutBehavior,
  type NotificationChannelType,
  type ReviewerGroupDto,
} from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { HitlGatesStore } from '../../store/hitl-gates.store';

/** Data passed to `MatDialog.open(GateDialogComponent, { data })`. */
export interface GateDialogData {
  /** Present only in edit mode. */
  existing?: HitlGateDto;
  reviewerGroups: ReviewerGroupDto[];
}

const ATTACHMENT_KINDS: HitlAttachmentKind[] = ['tool', 'skill', 'graph_node'];
const ALL_GATE_TYPES: HitlGateType[] = ['blocking', 'deferred', 'pre_speech', 'whisper', 'post_hoc'];
const TIMEOUT_BEHAVIORS: HitlTimeoutBehavior[] = ['auto_approve', 'auto_deny', 'escalate', 'defer_to_async'];
const NOTIFY_CHANNEL_TYPES: NotificationChannelType[] = ['in_app', 'email'];
const ENVIRONMENTS = ['dev', 'staging', 'production'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

const GATE_TYPE_LABELS: Record<HitlGateType, string> = {
  blocking: 'Blocking — caller waits on the line',
  deferred: 'Deferred — action queues, caller notified later',
  pre_speech: 'Pre-speech — review before the agent says it',
  whisper: 'Whisper — supervisor guides silently',
  post_hoc: 'Post-hoc — no caller impact, reviewed afterwards',
};

/**
 * Create/edit HITL gate dialog (HITL tab, Phase 14, BL-052..057 —
 * `docs/v2/UX_SCOPE.md` "HITL tab + Reviewer console", wireframe A8.4).
 * Covers R-H1's six mandatory fields (trigger condition, gate type,
 * reviewer group, SLA, hold treatment, timeout behaviour) plus attachment
 * kind/ref and notify channels — the exact `CreateHitlGateRequestSchema`
 * shape (`packages/contracts/src/hitl/schemas.ts`).
 *
 * `whisper`/`post_hoc` are always listed (never removed from the picker,
 * per the "show-disabled-with-reason" pattern `UX_GUIDELINES.md` §10.5
 * established for provider options) but rendered disabled with a
 * "Coming soon" reason — only `SUPPORTED_HITL_GATE_TYPES` can actually be
 * selected in v1.
 *
 * The trigger condition is a simple key/value list (v1 doesn't need a full
 * expression editor, per the task brief) serialized to the
 * `Record<string, unknown>` the wire contract expects, with every value
 * kept as a plain string.
 */
@Component({
  selector: 'la-gate-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gate-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './gate-dialog.component.scss'],
})
export class GateDialogComponent {
  private readonly store = inject(HitlGatesStore);
  readonly data = inject<GateDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<GateDialogComponent, HitlGateDto | undefined>);

  readonly isEdit = Boolean(this.data.existing);
  readonly attachmentKinds = ATTACHMENT_KINDS;
  readonly allGateTypes = ALL_GATE_TYPES;
  readonly gateTypeLabels = GATE_TYPE_LABELS;
  readonly timeoutBehaviors = TIMEOUT_BEHAVIORS;
  readonly notifyChannelTypes = NOTIFY_CHANNEL_TYPES;
  readonly environments = ENVIRONMENTS;

  readonly attachmentKind = signal<HitlAttachmentKind>(this.data.existing?.attachment_kind ?? 'tool');
  readonly attachmentRef = signal(this.data.existing?.attachment_ref ?? '');
  readonly triggerConditions = signal<{ key: string; value: string }[]>(
    Object.entries(this.data.existing?.trigger_condition ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  );
  readonly gateType = signal<HitlGateType>(this.data.existing?.gate_type ?? 'deferred');
  readonly reviewerGroupId = signal(this.data.existing?.reviewer_group_id ?? '');
  readonly slaSeconds = signal(this.data.existing?.sla_seconds ?? 45);
  readonly holdTreatmentText = signal(this.data.existing?.hold_treatment_text ?? '');
  readonly timeoutBehavior = signal<HitlTimeoutBehavior>(this.data.existing?.timeout_behavior ?? 'defer_to_async');
  readonly escalateToGroupId = signal(this.data.existing?.escalate_to_group_id ?? '');
  readonly autoApproveAckText = signal(this.data.existing?.auto_approve_ack_text ?? '');
  readonly notifyChannels = signal<NotificationChannelType[]>(this.data.existing?.notify_channels ?? []);
  readonly selectedEnvironments = signal<Environment[]>(
    (this.data.existing?.environments as Environment[] | undefined) ?? [...ENVIRONMENTS],
  );
  readonly status = signal(this.data.existing?.status ?? 'active');

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);

  isGateTypeDisabled(type: HitlGateType): boolean {
    return !(SUPPORTED_HITL_GATE_TYPES as readonly HitlGateType[]).includes(type);
  }

  readonly canSave = computed(() => {
    if (this.submitting()) {
      return false;
    }
    if (this.attachmentRef().trim().length === 0) {
      return false;
    }
    if (this.isGateTypeDisabled(this.gateType())) {
      return false;
    }
    if (!this.reviewerGroupId()) {
      return false;
    }
    if (this.slaSeconds() < 1 || this.slaSeconds() > 3600) {
      return false;
    }
    if (this.holdTreatmentText().trim().length === 0) {
      return false;
    }
    if (this.timeoutBehavior() === 'escalate' && !this.escalateToGroupId()) {
      return false;
    }
    // V-8/R-H2 — auto_approve requires a written acknowledgement.
    if (this.timeoutBehavior() === 'auto_approve' && this.autoApproveAckText().trim().length === 0) {
      return false;
    }
    return true;
  });

  addTriggerCondition(): void {
    this.triggerConditions.update((c) => [...c, { key: '', value: '' }]);
  }

  removeTriggerCondition(index: number): void {
    this.triggerConditions.update((c) => c.filter((_, i) => i !== index));
  }

  updateTriggerConditionKey(index: number, key: string): void {
    this.triggerConditions.update((c) => c.map((cond, i) => (i === index ? { ...cond, key } : cond)));
  }

  updateTriggerConditionValue(index: number, value: string): void {
    this.triggerConditions.update((c) => c.map((cond, i) => (i === index ? { ...cond, value } : cond)));
  }

  toggleNotifyChannel(type: NotificationChannelType): void {
    const current = this.notifyChannels();
    this.notifyChannels.set(current.includes(type) ? current.filter((t) => t !== type) : [...current, type]);
  }

  toggleEnvironment(env: Environment): void {
    const current = this.selectedEnvironments();
    this.selectedEnvironments.set(current.includes(env) ? current.filter((e) => e !== env) : [...current, env]);
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (!this.canSave()) {
      return;
    }
    this.submitting.set(true);
    this.dialogAlert.set(null);

    const trigger_condition: Record<string, unknown> = {};
    for (const { key, value } of this.triggerConditions()) {
      if (key.trim()) {
        trigger_condition[key.trim()] = value;
      }
    }

    const body = {
      attachment_kind: this.attachmentKind(),
      attachment_ref: this.attachmentRef().trim(),
      trigger_condition,
      gate_type: this.gateType(),
      reviewer_group_id: this.reviewerGroupId(),
      sla_seconds: this.slaSeconds(),
      hold_treatment_text: this.holdTreatmentText().trim(),
      timeout_behavior: this.timeoutBehavior(),
      escalate_to_group_id: this.timeoutBehavior() === 'escalate' ? this.escalateToGroupId() : null,
      auto_approve_ack_text: this.timeoutBehavior() === 'auto_approve' ? this.autoApproveAckText().trim() : null,
      notify_channels: this.notifyChannels(),
      environments: this.selectedEnvironments(),
    };

    if (this.isEdit) {
      this.store.update(
        this.data.existing!.id,
        { ...body, status: this.status() },
        (gate) => {
          this.submitting.set(false);
          this.dialogRef.close(gate);
        },
        (error) => this.handleError(error),
      );
    } else {
      this.store.create(
        body,
        (gate) => {
          this.submitting.set(false);
          this.dialogRef.close(gate);
        },
        (error) => this.handleError(error),
      );
    }
  }

  private handleError(error: AppClientError): void {
    this.submitting.set(false);
    this.dialogAlert.set(error.message || 'Could not save this gate. Try again.');
  }
}
