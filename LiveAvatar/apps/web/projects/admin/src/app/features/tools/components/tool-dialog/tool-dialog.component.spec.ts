import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ToolDialogComponent, type ToolDialogData } from './tool-dialog.component';
import { ToolsStore } from '../../store/tools.store';

function existingTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    tenant_id: 't-1',
    api_ref: 'lookup_order',
    name: 'Lookup order',
    description: null,
    method: 'GET',
    url: 'https://api.example.com/orders',
    credential_ref: null,
    requires_credential: false,
    args_schema: {},
    enabled: true,
    consequential: false,
    autonomous_use_ack_text: null,
    lane: 'foreground' as const,
    per_session_cap: null,
    per_turn_cap: null,
    timeout_ms: 10000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ToolDialogComponent', () => {
  let fixture: ComponentFixture<ToolDialogComponent>;
  let component: ToolDialogComponent;
  let store: { create: jest.Mock; update: jest.Mock };
  let dialogRef: { close: jest.Mock };

  async function setup(data: ToolDialogData) {
    store = { create: jest.fn(), update: jest.fn() };
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ToolDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: ToolsStore, useValue: store },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('disables submit until name and url are set (create mode)', async () => {
    await setup({});
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.name.setValue('Lookup order');
    component.form.controls.url.setValue('https://api.example.com/orders');
    expect(component.submitDisabled()).toBe(false);
  });

  it('creates a tool and closes with the result', async () => {
    await setup({});
    store.create.mockImplementation((_body, onSuccess) => onSuccess({ id: 'tool-1' }));
    component.form.controls.name.setValue('Lookup order');
    component.form.controls.url.setValue('https://api.example.com/orders');

    component.onSubmit();

    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lookup order', url: 'https://api.example.com/orders' }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(dialogRef.close).toHaveBeenCalledWith({ id: 'tool-1' });
  });

  it('blocks submit on malformed args_schema JSON without calling the API', async () => {
    await setup({});
    component.form.controls.name.setValue('Lookup order');
    component.form.controls.url.setValue('https://api.example.com/orders');
    component.form.controls.args_schema_json.setValue('{ not valid json');

    component.onSubmit();

    expect(component.argsSchemaJsonError()).toBe('Enter valid JSON.');
    expect(store.create).not.toHaveBeenCalled();
  });

  it('maps TOOL_CREDENTIAL_MISSING to the credential_ref field', async () => {
    await setup({});
    store.create.mockImplementation((_body, _onSuccess, onError) =>
      onError({ code: 'TOOL_CREDENTIAL_MISSING', message: 'Credential required.', status: 400, details: {} }),
    );
    component.form.controls.name.setValue('Lookup order');
    component.form.controls.url.setValue('https://api.example.com/orders');

    component.onSubmit();

    expect(component.form.controls.credential_ref.getError('server')).toBe('Credential required.');
  });

  it('edit mode pre-fills existing values and updates with the current If-Match', async () => {
    const existing = existingTool();
    await setup({ existing });

    expect(component.isEdit).toBe(true);
    expect(component.form.controls.name.value).toBe('Lookup order');

    store.update.mockImplementation((_id, _body, _ifMatch, onSuccess) => onSuccess(existing));
    component.onSubmit();

    expect(store.update).toHaveBeenCalledWith(
      'tool-1',
      expect.any(Object),
      '2026-01-01T00:00:00.000Z',
      expect.any(Function),
      expect.any(Function),
    );
  });
});
