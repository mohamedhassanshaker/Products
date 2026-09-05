import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type { NotificationChannelType, ReviewerGroupDto } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { ReviewerGroupsStore } from '../../store/reviewer-groups.store';

/** Data passed to `MatDialog.open(ReviewerGroupDialogComponent, { data })`. */
export interface ReviewerGroupDialogData {
  /** Present only in edit mode. */
  existing?: ReviewerGroupDto;
}

const CHANNEL_TYPES: NotificationChannelType[] = ['in_app', 'email'];

/**
 * Create/edit reviewer group dialog (HITL tab's reviewer-group management
 * section, Phase 14, BL-052..057 — `docs/v2/UX_SCOPE.md` "HITL tab +
 * Reviewer console"). Fields: name, members (a plain list of admin-user-id
 * strings — "no fancy user picker needed" per this phase's scope), and
 * notification channels (`in_app`/`email` + optional address). Built as
 * plain component state (signals), not `ReactiveFormsModule`, because the
 * channel list is a dynamic add/remove array — same reasoning
 * `node-inspector.component.ts`'s Router/Parallel branch lists already
 * establish for this codebase.
 */
@Component({
  selector: 'la-reviewer-group-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reviewer-group-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './reviewer-group-dialog.component.scss'],
})
export class ReviewerGroupDialogComponent {
  private readonly store = inject(ReviewerGroupsStore);
  readonly data = inject<ReviewerGroupDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ReviewerGroupDialogComponent, ReviewerGroupDto | undefined>);

  readonly isEdit = Boolean(this.data.existing);
  readonly channelTypes = CHANNEL_TYPES;

  readonly name = signal(this.data.existing?.name ?? '');
  /** Comma-separated admin-user-id list — "a simple list of admin-user-id strings is fine for v1, no fancy user picker needed" (task brief). */
  readonly membersText = signal((this.data.existing?.members ?? []).join(', '));
  readonly channels = signal<{ type: NotificationChannelType; address: string }[]>(
    (this.data.existing?.notification_channels ?? []).map((c) => ({ type: c.type, address: c.address ?? '' })),
  );

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);

  readonly canSave = computed(() => this.name().trim().length > 0 && !this.submitting());

  addChannel(): void {
    this.channels.update((c) => [...c, { type: 'in_app', address: '' }]);
  }

  removeChannel(index: number): void {
    this.channels.update((c) => c.filter((_, i) => i !== index));
  }

  updateChannelType(index: number, type: NotificationChannelType): void {
    this.channels.update((c) => c.map((ch, i) => (i === index ? { ...ch, type } : ch)));
  }

  updateChannelAddress(index: number, address: string): void {
    this.channels.update((c) => c.map((ch, i) => (i === index ? { ...ch, address } : ch)));
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

    const members = this.membersText()
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);
    const notification_channels = this.channels().map((c) => ({
      type: c.type,
      address: c.type === 'email' && c.address.trim() ? c.address.trim() : undefined,
    }));
    const body = { name: this.name().trim(), members, notification_channels };

    if (this.isEdit) {
      this.store.update(
        this.data.existing!.id,
        body,
        (group) => {
          this.submitting.set(false);
          this.dialogRef.close(group);
        },
        (error) => this.handleError(error),
      );
    } else {
      this.store.create(
        body,
        (group) => {
          this.submitting.set(false);
          this.dialogRef.close(group);
        },
        (error) => this.handleError(error),
      );
    }
  }

  private handleError(error: AppClientError): void {
    this.submitting.set(false);
    this.dialogAlert.set(error.message || 'Could not save this reviewer group. Try again.');
  }
}
