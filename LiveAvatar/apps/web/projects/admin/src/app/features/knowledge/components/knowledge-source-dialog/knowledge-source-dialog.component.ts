import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import type { ChunkingStrategy, KnowledgeSourceDto, KnowledgeSourceParser } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { KnowledgeSourcesStore } from '../../store/knowledge-sources.store';

/** Data passed to `MatDialog.open(KnowledgeSourceDialogComponent, { data })`. */
export interface KnowledgeSourceDialogData {
  /** Present only in edit mode. */
  existing?: KnowledgeSourceDto;
}

/** Only this model is selectable this phase (plan doc "Decisions made this phase" #1 — 1536-dim column width). */
const EMBEDDING_MODELS = ['text-embedding-3-small'] as const;

/** Front-end nicety only — the server is the real enforcement boundary (10 MiB cap, `.txt`/`.md`). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.txt', '.md'];
const ALLOWED_MIME_TYPES = ['text/plain', 'text/markdown'];

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * Create/edit knowledge-source dialog (Phase 12a RAG ingestion,
 * `docs/plans/agent-builder-v2-plan.md`). Field set: name, file (create mode
 * only), parser (plain text/markdown real, PDF visibly disabled), chunking
 * strategy (fixed real, semantic/heading-aware visibly disabled), chunk
 * size/overlap, embedding model, embedding credential ref. No source-type
 * selector — Upload is the only source type and isn't presented as a choice
 * at all (`UX_SCOPE.md`'s "omit entirely" vs. "show disabled" distinction).
 * Structurally mirrors `ToolDialogComponent`.
 */
@Component({
  selector: 'la-knowledge-source-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './knowledge-source-dialog.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './knowledge-source-dialog.component.scss'],
})
export class KnowledgeSourceDialogComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly store = inject(KnowledgeSourcesStore);
  readonly data = inject<KnowledgeSourceDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<KnowledgeSourceDialogComponent, KnowledgeSourceDto | undefined>);

  readonly isEdit = Boolean(this.data.existing);
  readonly embeddingModels = EMBEDDING_MODELS;

  readonly form = this.fb.group({
    name: this.fb.control(this.data.existing?.name ?? ''),
    parser: this.fb.control<KnowledgeSourceParser>(this.data.existing?.parser ?? 'plain_text'),
    chunking_strategy: this.fb.control<ChunkingStrategy>(this.data.existing?.chunking_strategy ?? 'fixed'),
    chunk_size: this.fb.control(this.data.existing?.chunk_size ?? DEFAULT_CHUNK_SIZE),
    chunk_overlap: this.fb.control(this.data.existing?.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP),
    embedding_model: this.fb.control(this.data.existing?.embedding_model ?? EMBEDDING_MODELS[0]),
    embedding_credential_ref: this.fb.control(this.data.existing?.embedding_credential_ref ?? ''),
  });

  readonly submitting = signal(false);
  readonly dialogAlert = signal<string | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);

  /**
   * Client-side file-type/size check — a UX nicety that front-loads a
   * clearer error than a round trip to the server. It is NOT a security
   * boundary: the server independently re-validates type and size
   * (`KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED` / `KNOWLEDGE_SOURCE_FILE_TOO_LARGE`)
   * and is what actually enforces the limit.
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.fileError.set(null);
    this.selectedFile.set(null);
    if (!file) {
      return;
    }

    const lowerName = file.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const hasAllowedMimeType = file.type === '' || ALLOWED_MIME_TYPES.includes(file.type);
    if (!hasAllowedExtension || !hasAllowedMimeType) {
      this.fileError.set('Only plain text (.txt) and markdown (.md) files are supported.');
      input.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      this.fileError.set('File exceeds the 10 MiB upload limit.');
      input.value = '';
      return;
    }
    this.selectedFile.set(file);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  /** `chunk_overlap` must be less than `chunk_size` (mirrors `KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID`). */
  overlapError(): string | null {
    if (this.form.controls.chunk_overlap.hasError('server')) {
      return this.form.controls.chunk_overlap.getError('server') as string;
    }
    return this.form.controls.chunk_overlap.value >= this.form.controls.chunk_size.value
      ? 'Overlap must be less than chunk size.'
      : null;
  }

  submitDisabled(): boolean {
    if (this.submitting()) {
      return true;
    }
    if (this.form.controls.name.value.trim().length === 0) {
      return true;
    }
    if (!this.isEdit && (!this.selectedFile() || this.fileError())) {
      return true;
    }
    return this.form.controls.chunk_overlap.value >= this.form.controls.chunk_size.value;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.dialogAlert.set(null);

    const body = {
      name: this.form.controls.name.value.trim(),
      parser: this.form.controls.parser.value,
      chunking_strategy: this.form.controls.chunking_strategy.value,
      chunk_size: this.form.controls.chunk_size.value,
      chunk_overlap: this.form.controls.chunk_overlap.value,
      embedding_model: this.form.controls.embedding_model.value,
      embedding_credential_ref: this.form.controls.embedding_credential_ref.value.trim() || undefined,
    };

    if (this.isEdit) {
      this.store.update(
        this.data.existing!.id,
        body,
        this.data.existing!.updated_at,
        (source) => {
          this.submitting.set(false);
          this.dialogRef.close(source);
        },
        (error) => this.handleError(error),
      );
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.submitting.set(false);
      return;
    }
    this.store.create(
      body,
      file,
      (source) => {
        this.submitting.set(false);
        this.dialogRef.close(source);
      },
      (error) => this.handleError(error),
    );
  }

  private handleError(error: AppClientError): void {
    this.submitting.set(false);
    switch (error.code) {
      case 'KNOWLEDGE_SOURCE_NAME_REQUIRED':
        this.form.controls.name.setErrors({ server: error.message });
        break;
      case 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID':
        this.form.controls.chunk_overlap.setErrors({ server: error.message });
        break;
      case 'KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED':
      case 'KNOWLEDGE_SOURCE_FILE_TOO_LARGE':
      case 'KNOWLEDGE_SOURCE_FILE_MISSING':
        this.fileError.set(error.message);
        break;
      case 'CONFIG_CONFLICT':
        this.dialogAlert.set('This knowledge source was changed by someone else. Close and reopen to see the latest.');
        break;
      default:
        this.dialogAlert.set('Could not save this knowledge source. Check your connection and try again.');
    }
  }
}
