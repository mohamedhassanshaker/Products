import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type { ToolDto, ToolMethod, ToolLane } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { ToolsStore } from '../../store/tools.store';

/** Data passed to `MatDialog.open(ToolDialogComponent, { data })`. */
export interface ToolDialogData {
  /** Present only in edit mode. */
  existing?: ToolDto;
}

const METHODS: ToolMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const LANES: ToolLane[] = ['foreground', 'background'];

/**
 * Create/edit tool dialog (BL-033, `docs/v2/UX_SCOPE.md` "Tools tab").
 * Field set: name, HTTP method/URL, credential ref (+ requires-credential
 * flag, TOOL_CREDENTIAL_MISSING), args schema (JSON), timeout, lane,
 * consequential flag, per-session/per-turn caps, and (Phase 14 follow-up,
 * BL-057, V-6) an `autonomous_use_ack_text` opt-out for a consequential
 * tool with no gate attached. A plain always-available optional textarea
 * next to the consequential toggle, per this phase's own scope decision
 * — cross-referencing live gate data here (to require it only when truly
 * ungated) is deferred; the application layer enforces the real
 * `CONFIG_CONSEQUENTIAL_TOOL_UNGATED` rule at publish time regardless of
 * what this form does or doesn't show.
 */
@Component({
  selector: 'la-tool-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tool-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss'],
})
export class ToolDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly store = inject(ToolsStore);
  readonly data = inject<ToolDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ToolDialogComponent, ToolDto | undefined>);

  readonly isEdit = Boolean(this.data.existing);
  readonly methods = METHODS;
  readonly lanes = LANES;

  readonly form = this.fb.group({
    name: this.fb.control(this.data.existing?.name ?? ''),
    method: this.fb.control<ToolMethod>((this.data.existing?.method as ToolMethod) ?? 'GET'),
    url: this.fb.control(this.data.existing?.url ?? ''),
    description: this.fb.control(this.data.existing?.description ?? ''),
    credential_ref: this.fb.control(this.data.existing?.credential_ref ?? ''),
    requires_credential: this.fb.control(this.data.existing?.requires_credential ?? false),
    args_schema_json: this.fb.control(
      this.data.existing ? JSON.stringify(this.data.existing.args_schema ?? {}) : '',
    ),
    timeout_ms: this.fb.control(this.data.existing?.timeout_ms ?? 10000),
    lane: this.fb.control<ToolLane>(this.data.existing?.lane ?? 'foreground'),
    consequential: this.fb.control(this.data.existing?.consequential ?? false),
    autonomous_use_ack_text: this.fb.control(this.data.existing?.autonomous_use_ack_text ?? ''),
    enabled: this.fb.control(this.data.existing?.enabled ?? true),
    per_session_cap: this.fb.control(this.data.existing?.per_session_cap ?? null),
    per_turn_cap: this.fb.control(this.data.existing?.per_turn_cap ?? null),
  });

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);
  readonly argsSchemaJsonError = signal<string | null>(null);

  submitDisabled(): boolean {
    const name = this.form.controls.name.value.trim();
    const url = this.form.controls.url.value.trim();
    return this.submitting() || name.length === 0 || url.length === 0;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    let argsSchema: Record<string, unknown> | undefined;
    const rawJson = this.form.controls.args_schema_json.value.trim();
    this.argsSchemaJsonError.set(null);
    if (rawJson) {
      try {
        argsSchema = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        this.argsSchemaJsonError.set('Enter valid JSON.');
        return;
      }
    }

    this.submitting.set(true);
    this.dialogAlert.set(null);

    const body = {
      name: this.form.controls.name.value.trim(),
      method: this.form.controls.method.value,
      url: this.form.controls.url.value.trim(),
      description: this.form.controls.description.value.trim() || undefined,
      credential_ref: this.form.controls.credential_ref.value.trim() || undefined,
      requires_credential: this.form.controls.requires_credential.value,
      args_schema: argsSchema,
      timeout_ms: this.form.controls.timeout_ms.value,
      lane: this.form.controls.lane.value,
      consequential: this.form.controls.consequential.value,
      autonomous_use_ack_text: this.form.controls.autonomous_use_ack_text.value.trim() || null,
      enabled: this.form.controls.enabled.value,
      per_session_cap: this.form.controls.per_session_cap.value,
      per_turn_cap: this.form.controls.per_turn_cap.value,
    };

    if (this.isEdit) {
      this.store.update(this.data.existing!.id, body, this.data.existing!.updated_at, (tool) => {
        this.submitting.set(false);
        this.dialogRef.close(tool);
      }, (error) => this.handleError(error));
    } else {
      this.store.create(body, (tool) => {
        this.submitting.set(false);
        this.dialogRef.close(tool);
      }, (error) => this.handleError(error));
    }
  }

  private handleError(error: AppClientError): void {
    this.submitting.set(false);
    switch (error.code) {
      case 'TOOL_NAME_REQUIRED':
        this.form.controls.name.setErrors({ server: error.message });
        break;
      case 'TOOL_URL_INVALID':
        this.form.controls.url.setErrors({ server: error.message });
        break;
      case 'TOOL_CREDENTIAL_MISSING':
        this.form.controls.credential_ref.setErrors({ server: error.message });
        break;
      case 'TOOL_API_REF_EXISTS':
        this.form.controls.name.setErrors({ server: error.message });
        break;
      case 'CONFIG_CONFLICT':
        this.dialogAlert.set('This tool was changed by someone else. Close and reopen to see the latest.');
        break;
      default:
        this.dialogAlert.set('Could not save this tool. Check your connection and try again.');
    }
  }
}
