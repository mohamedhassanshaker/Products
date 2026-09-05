import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type { ProviderCredentialDto, ProviderDefinitionDto } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { ProviderRegistryService } from '../../services/provider-registry.service';

/** Data passed to `MatDialog.open(CredentialDialogComponent, { data })`. */
export interface CredentialDialogData {
  tenantId: string;
  /** Enabled catalog entries (create mode: choosable; edit mode: display-only). */
  definitions: ProviderDefinitionDto[];
  /** Present only in edit mode. */
  existing?: ProviderCredentialDto;
}

/**
 * Add/edit provider credential dialog (FR-PROVIDER-2, UX_GUIDELINES §9.9
 * field spec). The credential value itself is never collected — only a
 * `credential_ref` pointer into the operator's own secret store.
 */
@Component({
  selector: 'la-credential-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credential-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './credential-dialog.component.scss'],
})
export class CredentialDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly registry = inject(ProviderRegistryService);
  readonly data = inject<CredentialDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CredentialDialogComponent, ProviderCredentialDto | undefined>);

  readonly isEdit = Boolean(this.data.existing);

  readonly form = this.fb.group({
    provider_key: this.fb.control(this.data.existing?.provider_key ?? ''),
    endpoint_url: this.fb.control(this.data.existing?.endpoint_url ?? ''),
    credential_ref: this.fb.control(this.data.existing?.credential_ref ?? ''),
    display_label: this.fb.control(this.data.existing?.display_label ?? ''),
    extra_json: this.fb.control(this.data.existing ? JSON.stringify(this.data.existing.extra ?? {}) : ''),
  });

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);
  readonly extraJsonError = signal<string | null>(null);

  submitDisabled(): boolean {
    const providerKey = this.form.controls.provider_key.value;
    const endpoint = this.form.controls.endpoint_url.value.trim();
    return this.submitting() || providerKey.length === 0 || endpoint.length === 0;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    let extra: Record<string, unknown> | undefined;
    const rawExtra = this.form.controls.extra_json.value.trim();
    this.extraJsonError.set(null);
    if (rawExtra) {
      try {
        extra = JSON.parse(rawExtra) as Record<string, unknown>;
      } catch {
        this.extraJsonError.set('Enter valid JSON.');
        return;
      }
    }

    this.submitting.set(true);
    this.dialogAlert.set(null);

    const credentialRef = this.form.controls.credential_ref.value.trim() || undefined;
    const displayLabel = this.form.controls.display_label.value.trim() || undefined;
    const endpointUrl = this.form.controls.endpoint_url.value.trim();

    const request$ = this.isEdit
      ? this.registry.updateCredential(
          this.data.tenantId,
          this.data.existing!.id,
          { endpoint_url: endpointUrl, credential_ref: credentialRef, display_label: displayLabel, extra },
          this.data.existing!.updated_at,
        )
      : this.registry.createCredential(this.data.tenantId, {
          provider_key: this.form.controls.provider_key.value,
          endpoint_url: endpointUrl,
          credential_ref: credentialRef,
          display_label: displayLabel,
          extra,
        });

    request$.subscribe({
      next: (credential) => {
        this.submitting.set(false);
        this.dialogRef.close(credential);
      },
      error: (error: AppClientError) => {
        this.submitting.set(false);
        this.handleError(error);
      },
    });
  }

  private handleError(error: AppClientError): void {
    switch (error.code) {
      case 'PROVIDER_UNKNOWN':
        this.form.controls.provider_key.setErrors({ server: error.message });
        break;
      case 'PROVIDER_ENDPOINT_INVALID':
        this.form.controls.endpoint_url.setErrors({ server: error.message });
        break;
      case 'PROVIDER_SECRET_IN_BODY':
        this.form.controls.extra_json.setErrors({ server: error.message });
        break;
      case 'PROVIDER_CREDENTIAL_EXISTS':
        this.form.controls.display_label.setErrors({ server: error.message });
        break;
      case 'CONFIG_CONFLICT':
        this.dialogAlert.set('This credential was changed by someone else. Close and reopen to see the latest.');
        break;
      default:
        this.dialogAlert.set('Could not save this credential. Check your connection and try again.');
    }
  }
}
