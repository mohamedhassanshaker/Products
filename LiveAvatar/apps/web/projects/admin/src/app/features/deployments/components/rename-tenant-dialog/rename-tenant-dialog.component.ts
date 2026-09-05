import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { TenantDto } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { DeploymentsService } from '../../services/deployments.service';

export interface RenameTenantDialogData {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
}

/** Rename-deployment dialog (FR-TENANT-3, UX_GUIDELINES §5.1). Slug is immutable and shown read-only. */
@Component({
  selector: 'la-rename-tenant-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rename-tenant-dialog.component.html',
  styleUrl: '../dialog-shared.scss',
})
export class RenameTenantDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly deployments = inject(DeploymentsService);
  private readonly dialogRef = inject(MatDialogRef<RenameTenantDialogComponent, TenantDto | undefined>);
  readonly data = inject<RenameTenantDialogData>(MAT_DIALOG_DATA);

  readonly form = this.fb.group({
    name: this.fb.control(this.data.name),
  });

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);
  readonly conflict = signal(false);

  private currentIfMatch = this.data.updatedAt;

  nameInvalid(): boolean {
    const control = this.form.controls.name;
    if (!control.touched) {
      return false;
    }
    const value = control.value.trim();
    return value.length === 0 || value.length > 80;
  }

  submitDisabled(): boolean {
    const value = this.form.controls.name.value.trim();
    return this.submitting() || value.length === 0 || value.length > 80;
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.dialogAlert.set(null);
    this.conflict.set(false);

    this.deployments.rename(this.data.id, this.form.controls.name.value.trim(), this.currentIfMatch).subscribe({
      next: (tenant) => {
        this.submitting.set(false);
        this.dialogRef.close(tenant);
      },
      error: (error: AppClientError) => {
        this.submitting.set(false);
        this.handleError(error);
      },
    });
  }

  onRetry(): void {
    this.deployments.get(this.data.id).subscribe((tenant) => {
      this.currentIfMatch = tenant.updated_at;
      this.conflict.set(false);
      this.dialogAlert.set(null);
    });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  private handleError(error: AppClientError): void {
    switch (error.code) {
      case 'TENANT_NAME_INVALID':
        this.form.controls.name.setErrors({ server: error.message });
        break;
      case 'TENANT_CONFLICT':
        this.conflict.set(true);
        this.dialogAlert.set(error.message);
        break;
      case 'TENANT_NOT_FOUND':
      case 'TENANT_FORBIDDEN':
        this.dialogAlert.set(error.message);
        break;
      default:
        this.dialogAlert.set('Could not rename the deployment. Check your connection and try again.');
    }
  }
}
