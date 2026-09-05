import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

/** Data passed to `MatDialog.open(ConfirmDialogComponent, { data })`. */
export interface ConfirmDialogData {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Renders the confirm button in the error/warn color (e.g. Pause). */
  destructive?: boolean;
}

/**
 * Confirm destructive/pause action (LLD §3.2 shared primitive). APG dialog
 * semantics come from `MatDialogModule` (UX_GUIDELINES §5.4): focuses the
 * title, traps focus, Escape cancels.
 */
@Component({
  selector: 'la-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.body }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        mat-flat-button
        type="button"
        [color]="data.destructive ? 'warn' : 'primary'"
        [mat-dialog-close]="true"
      >
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
