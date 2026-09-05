import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DynamicsTabComponent } from './dynamics-tab.component';
import { AgentBuilderStore } from '../../store/agent-builder.store';

const DEFAULT_DYNAMICS = {
  barge_in: { enabled: true, sensitivity: 'medium' as const },
  endpointing_silence_ms: 700,
  verbosity: 'balanced' as const,
  no_input: { timeout_ms: 8000, max_reprompts: 2 },
  call_limits: { max_turn_tokens: 200, max_turn_seconds: 20 },
};

describe('DynamicsTabComponent', () => {
  let fixture: ComponentFixture<DynamicsTabComponent>;
  let component: DynamicsTabComponent;
  let store: {
    load: jest.Mock;
    status: jest.Mock;
    dynamics: jest.Mock;
    errorsByField: jest.Mock;
    patchDraft: jest.Mock;
  };

  beforeEach(async () => {
    store = {
      load: jest.fn(),
      status: jest.fn(() => 'ready'),
      dynamics: jest.fn(() => DEFAULT_DYNAMICS),
      errorsByField: jest.fn(() => new Map()),
      patchDraft: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DynamicsTabComponent, NoopAnimationsModule],
      providers: [
        { provide: AgentBuilderStore, useValue: store },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicsTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not call store.load — the shell owns loading the shared draft', () => {
    expect(store.load).not.toHaveBeenCalled();
  });

  it('shows the schema defaults when the config has never had a dynamics block', () => {
    const input = fixture.nativeElement.querySelector('input[name="endpointingSilenceMs"]') as HTMLInputElement;
    expect(input.value).toBe('700');
  });

  it('onBargeInEnabled/onBargeInSensitivity merge into the existing barge_in object', () => {
    component.onBargeInEnabled(false);
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, barge_in: { enabled: false, sensitivity: 'medium' } },
    });
    component.onBargeInSensitivity('high');
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, barge_in: { enabled: true, sensitivity: 'high' } },
    });
  });

  it('onEndpointingSilenceMs/onVerbosity write a whole new dynamics object', () => {
    component.onEndpointingSilenceMs(900);
    expect(store.patchDraft).toHaveBeenCalledWith({ dynamics: { ...DEFAULT_DYNAMICS, endpointing_silence_ms: 900 } });
    component.onVerbosity('detailed');
    expect(store.patchDraft).toHaveBeenCalledWith({ dynamics: { ...DEFAULT_DYNAMICS, verbosity: 'detailed' } });
  });

  it('onNoInputTimeoutMs/onNoInputMaxReprompts merge into no_input without clobbering the other field', () => {
    component.onNoInputTimeoutMs(12000);
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, no_input: { timeout_ms: 12000, max_reprompts: 2 } },
    });
    component.onNoInputMaxReprompts(4);
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, no_input: { timeout_ms: 8000, max_reprompts: 4 } },
    });
  });

  it('onMaxTurnTokens/onMaxTurnSeconds merge into call_limits without clobbering the other field', () => {
    component.onMaxTurnTokens(300);
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, call_limits: { max_turn_tokens: 300, max_turn_seconds: 20 } },
    });
    component.onMaxTurnSeconds(30);
    expect(store.patchDraft).toHaveBeenCalledWith({
      dynamics: { ...DEFAULT_DYNAMICS, call_limits: { max_turn_tokens: 200, max_turn_seconds: 30 } },
    });
  });

  it('errorsFor maps the store errorsByField map to message strings for a Gate A structural error', () => {
    store.errorsByField.mockReturnValue(
      new Map([['/dynamics/endpointing_silence_ms', [{ code: 'CONFIG_YAML_PARSE', message: 'Out of range.' }]]]),
    );
    expect(component.errorsFor('/dynamics/endpointing_silence_ms')).toEqual(['Out of range.']);
    expect(component.errorsFor('/dynamics/verbosity')).toEqual([]);
  });
});
