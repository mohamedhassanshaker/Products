import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { KnowledgeSourceDialogComponent, type KnowledgeSourceDialogData } from './knowledge-source-dialog.component';
import { KnowledgeSourcesStore } from '../../store/knowledge-sources.store';

function existingSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    tenant_id: 't-1',
    name: 'Handbook',
    source_type: 'upload' as const,
    original_filename: 'handbook.txt',
    mime_type: 'text/plain',
    file_size_bytes: 2048,
    parser: 'plain_text' as const,
    chunking_strategy: 'fixed' as const,
    chunk_size: 1000,
    chunk_overlap: 100,
    embedding_model: 'text-embedding-3-small',
    embedding_credential_ref: null,
    status: 'ready' as const,
    chunk_count: 12,
    error_message: null,
    is_stale: false,
    config_updated_at: '2026-01-01T00:00:00.000Z',
    last_indexed_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fileEvent(file: File | null): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: file ? [file] : [], writable: false });
  return { target: input } as unknown as Event;
}

describe('KnowledgeSourceDialogComponent', () => {
  let fixture: ComponentFixture<KnowledgeSourceDialogComponent>;
  let component: KnowledgeSourceDialogComponent;
  let store: { create: jest.Mock; update: jest.Mock };
  let dialogRef: { close: jest.Mock };

  async function setup(data: KnowledgeSourceDialogData) {
    store = { create: jest.fn(), update: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [KnowledgeSourceDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: KnowledgeSourcesStore, useValue: store },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgeSourceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('disables submit until a name and a valid file are set (create mode)', async () => {
    await setup({});
    expect(component.submitDisabled()).toBe(true);

    component.form.controls.name.setValue('Handbook');
    expect(component.submitDisabled()).toBe(true); // still no file

    component.onFileSelected(fileEvent(new File(['hello'], 'handbook.txt', { type: 'text/plain' })));
    expect(component.submitDisabled()).toBe(false);
  });

  it('rejects an unsupported file type client-side without touching the server', async () => {
    await setup({});
    const badFile = new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' });

    component.onFileSelected(fileEvent(badFile));

    expect(component.fileError()).toBe('Only plain text (.txt) and markdown (.md) files are supported.');
    expect(component.selectedFile()).toBeNull();
  });

  it('accepts a .txt file and clears any previous file error', async () => {
    await setup({});
    component.onFileSelected(fileEvent(new File(['x'], 'bad.pdf', { type: 'application/pdf' })));
    expect(component.fileError()).not.toBeNull();

    component.onFileSelected(fileEvent(new File(['hello'], 'notes.md', { type: 'text/markdown' })));

    expect(component.fileError()).toBeNull();
    expect(component.selectedFile()?.name).toBe('notes.md');
  });

  it('flags an overlap that is not strictly less than chunk size and disables submit', async () => {
    await setup({});
    component.form.controls.name.setValue('Handbook');
    component.onFileSelected(fileEvent(new File(['hello'], 'a.txt', { type: 'text/plain' })));
    expect(component.submitDisabled()).toBe(false);

    component.form.controls.chunk_size.setValue(100);
    component.form.controls.chunk_overlap.setValue(100);

    expect(component.overlapError()).toBe('Overlap must be less than chunk size.');
    expect(component.submitDisabled()).toBe(true);
  });

  it('disables the PDF parser and the Semantic/Heading-aware chunking options in the DOM (not just visually)', async () => {
    await setup({});
    const pdfInput = fixture.debugElement.query(By.css('mat-radio-button[value="pdf"] input')).nativeElement as HTMLInputElement;
    const semanticInput = fixture.debugElement.query(By.css('mat-radio-button[value="semantic"] input'))
      .nativeElement as HTMLInputElement;
    const headingInput = fixture.debugElement.query(By.css('mat-radio-button[value="heading_aware"] input'))
      .nativeElement as HTMLInputElement;
    const plainTextInput = fixture.debugElement.query(By.css('mat-radio-button[value="plain_text"] input'))
      .nativeElement as HTMLInputElement;
    const fixedInput = fixture.debugElement.query(By.css('mat-radio-button[value="fixed"] input'))
      .nativeElement as HTMLInputElement;

    expect(pdfInput.disabled).toBe(true);
    expect(semanticInput.disabled).toBe(true);
    expect(headingInput.disabled).toBe(true);
    expect(plainTextInput.disabled).toBe(false);
    expect(fixedInput.disabled).toBe(false);
  });

  it('does not render a file input in edit mode', async () => {
    await setup({ existing: existingSource() });
    expect(fixture.nativeElement.querySelector('#la-knowledge-file-input')).toBeNull();
  });

  it('creates a source, passing the selected file through to the store', async () => {
    await setup({});
    store.create.mockImplementation((_body, _file, onSuccess) => onSuccess(existingSource({ id: 'src-2' })));
    const file = new File(['hello'], 'handbook.txt', { type: 'text/plain' });
    component.form.controls.name.setValue('Handbook');
    component.onFileSelected(fileEvent(file));

    component.onSubmit();

    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Handbook', chunking_strategy: 'fixed', parser: 'plain_text' }),
      file,
      expect.any(Function),
      expect.any(Function),
    );
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({ id: 'src-2' }));
  });

  it('edit mode pre-fills existing values and updates with the current If-Match, without a file argument', async () => {
    const existing = existingSource();
    await setup({ existing });

    expect(component.isEdit).toBe(true);
    expect(component.form.controls.name.value).toBe('Handbook');
    expect(component.form.controls.chunk_size.value).toBe(1000);

    store.update.mockImplementation((_id, _body, _ifMatch, onSuccess) => onSuccess(existing));
    component.onSubmit();

    expect(store.update).toHaveBeenCalledWith(
      'src-1',
      expect.not.objectContaining({ file: expect.anything() }),
      '2026-01-01T00:00:00.000Z',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('maps KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID to the chunk_overlap field', async () => {
    await setup({});
    store.create.mockImplementation((_body, _file, _onSuccess, onError) =>
      onError({ code: 'KNOWLEDGE_SOURCE_CHUNK_OVERLAP_INVALID', message: 'Overlap must be smaller.', status: 400, details: {} }),
    );
    component.form.controls.name.setValue('Handbook');
    component.onFileSelected(fileEvent(new File(['hello'], 'a.txt', { type: 'text/plain' })));

    component.onSubmit();

    expect(component.form.controls.chunk_overlap.getError('server')).toBe('Overlap must be smaller.');
  });

  it('maps KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED to the file error', async () => {
    await setup({});
    store.create.mockImplementation((_body, _file, _onSuccess, onError) =>
      onError({ code: 'KNOWLEDGE_SOURCE_FILE_TYPE_UNSUPPORTED', message: 'Unsupported file type.', status: 400, details: {} }),
    );
    component.form.controls.name.setValue('Handbook');
    component.onFileSelected(fileEvent(new File(['hello'], 'a.txt', { type: 'text/plain' })));

    component.onSubmit();

    expect(component.fileError()).toBe('Unsupported file type.');
  });
});
