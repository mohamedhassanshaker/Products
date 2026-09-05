import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { TenantDto } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { DeploymentsService } from '../../services/deployments.service';
import { SLUG_PATTERN, slugify } from './slug.util';

/** Create-deployment dialog (FR-TENANT-1, UX_GUIDELINES §5.1/§5.9). */
@Component({
  selector: 'la-create-tenant-dialog',
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
  templateUrl: './create-tenant-dialog.component.html',
  styleUrl: '../dialog-shared.scss',
})
export class CreateTenantDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly deployments = inject(DeploymentsService);
  private readonly dialogRef = inject(MatDialogRef<CreateTenantDialogComponent, TenantDto | undefined>);

  readonly form = this.fb.group({
    name: this.fb.control(''),
    slug: this.fb.control(''),
  });

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);

  private slugManuallyEdited = false;

  onNameInput(): void {
    if (!this.slugManuallyEdited) {
      this.form.controls.slug.setValue(slugify(this.form.controls.name.value), { emitEvent: false });
    }
  }

  onSlugInput(): void {
    this.slugManuallyEdited = true;
  }

  nameInvalid(): boolean {
    const control = this.form.controls.name;
    if (!control.touched) {
      return false;
    }
    const value = control.value.trim();
    return value.length === 0 || value.length > 80;
  }

  slugInvalid(): boolean {
    const control = this.form.controls.slug;
    return control.touched && !SLUG_PATTERN.test(control.value);
  }

  submitDisabled(): boolean {
    const name = this.form.controls.name.value.trim();
    const slug = this.form.controls.slug.value;
    return this.submitting() || name.length === 0 || name.length > 80 || !SLUG_PATTERN.test(slug);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.dialogAlert.set(null);

    this.deployments
      .create({ name: this.form.controls.name.value.trim(), slug: this.form.controls.slug.value })
      .subscribe({
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

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  private handleError(error: AppClientError): void {
    switch (error.code) {
      case 'TENANT_NAME_INVALID':
        this.form.controls.name.setErrors({ server: error.message });
        break;
      case 'TENANT_SLUG_INVALID':
      case 'TENANT_SLUG_EXISTS':
        this.form.controls.slug.setErrors({ server: error.message });
        break;
      case 'TENANT_LIMIT_REACHED':
      case 'IDEMPOTENCY_KEY_REUSED':
        this.dialogAlert.set(error.message);
        break;
      default:
        this.dialogAlert.set('Could not create the deployment. Check your connection and try again.');
    }
  }
}
