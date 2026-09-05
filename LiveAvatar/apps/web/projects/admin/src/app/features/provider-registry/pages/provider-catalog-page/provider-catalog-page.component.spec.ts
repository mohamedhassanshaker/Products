import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { ProviderDefinitionDto } from '@liveavatar/contracts';
import { ProviderCatalogPageComponent } from './provider-catalog-page.component';
import { ProviderRegistryService } from '../../services/provider-registry.service';
import { AuthStore } from '../../../../core/auth/auth.store';

function def(overrides: Partial<ProviderDefinitionDto> = {}): ProviderDefinitionDto {
  return {
    key: 'openai',
    category: 'llm',
    display_name: 'OpenAI',
    hosting: 'remote',
    interface_name: 'ILLMProvider',
    requires_credential: true,
    enabled: true,
    feature_gaps: null,
    ...overrides,
  };
}

describe('ProviderCatalogPageComponent', () => {
  let fixture: ComponentFixture<ProviderCatalogPageComponent>;
  let component: ProviderCatalogPageComponent;
  let registry: { listDefinitions: jest.Mock; setDefinitionEnabled: jest.Mock };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  async function setup(items: ProviderDefinitionDto[] = [def()], isOperator = true) {
    registry = {
      listDefinitions: jest.fn(() => of({ items })),
      setDefinitionEnabled: jest.fn(),
    };
    dialog = { open: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ProviderCatalogPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AuthStore, useValue: { isOperator: () => isOperator } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderCatalogPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads and groups the catalog by category', async () => {
    await setup([def({ key: 'openai', category: 'llm' }), def({ key: 'livekit', category: 'transport' })]);
    expect(component.groups().map((g) => g.category)).toEqual(['transport', 'llm']);
  });

  it('shows a load error state with Retry', async () => {
    registry = { listDefinitions: jest.fn(() => throwError(() => ({ code: 'INTERNAL_ERROR', message: 'x', status: 500, details: {} }))), setDefinitionEnabled: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ProviderCatalogPageComponent, NoopAnimationsModule],
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AuthStore, useValue: { isOperator: () => true } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProviderCatalogPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.loadError()).not.toBeNull();
  });

  it('enables a provider without a confirm dialog', async () => {
    await setup();
    registry.setDefinitionEnabled.mockReturnValue(of(def({ enabled: true })));
    component.onToggle(def({ enabled: false }), { checked: true, source: { checked: false } } as never);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(registry.setDefinitionEnabled).toHaveBeenCalledWith('openai', { enabled: true });
  });

  it('confirms before disabling and reverts the toggle on cancel', async () => {
    await setup();
    const toggleEvent = { checked: false, source: { checked: false } } as never;
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    component.onToggle(def({ enabled: true }), toggleEvent);
    expect(registry.setDefinitionEnabled).not.toHaveBeenCalled();
    expect((toggleEvent as { source: { checked: boolean } }).source.checked).toBe(true);
  });

  it('shows an inline row error and reverts on PROVIDER_CATEGORY_EMPTY', async () => {
    await setup();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    registry.setDefinitionEnabled.mockReturnValue(
      throwError(() => ({ code: 'PROVIDER_CATEGORY_EMPTY', message: 'At least one provider must remain enabled in this category.', status: 422, details: {} })),
    );
    const toggleEvent = { checked: false, source: { checked: false } } as never;
    component.onToggle(def({ key: 'openai', enabled: true }), toggleEvent);
    expect(component.rowErrors()['openai']).toContain('At least one provider');
  });
});
