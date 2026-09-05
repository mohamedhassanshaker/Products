import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PipelineTabComponent } from './pipeline-tab.component';
import { AgentBuilderStore } from '../../store/agent-builder.store';

describe('PipelineTabComponent', () => {
  let fixture: ComponentFixture<PipelineTabComponent>;
  let component: PipelineTabComponent;
  let store: {
    load: jest.Mock;
    draft: jest.Mock;
    status: jest.Mock;
    definitions: jest.Mock;
    credentials: jest.Mock;
    errorsByLayer: jest.Mock;
    patchDraft: jest.Mock;
  };

  beforeEach(async () => {
    store = {
      load: jest.fn(),
      draft: jest.fn(() => ({})),
      status: jest.fn(() => 'ready'),
      definitions: jest.fn(() => []),
      credentials: jest.fn(() => []),
      errorsByLayer: jest.fn(() => new Map()),
      patchDraft: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PipelineTabComponent, NoopAnimationsModule],
      providers: [
        { provide: AgentBuilderStore, useValue: store },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PipelineTabComponent);
    component = fixture.componentInstance;
  });

  it('does not call store.load — the shell owns loading the shared draft', () => {
    fixture.detectChanges();
    expect(store.load).not.toHaveBeenCalled();
  });

  it('disables an option whose provider has no tenant credential and requires one', () => {
    store.definitions.mockReturnValue([
      { key: 'openai', category: 'llm', display_name: 'OpenAI', hosting: 'remote', interface_name: 'ILLMProvider', requires_credential: true, enabled: true, feature_gaps: null },
    ]);
    store.credentials.mockReturnValue([]);
    fixture.detectChanges();
    expect(component.optionDisabled('openai')).toBe(true);
  });

  it('enables an option once a tenant credential exists', () => {
    store.definitions.mockReturnValue([
      { key: 'openai', category: 'llm', display_name: 'OpenAI', hosting: 'remote', interface_name: 'ILLMProvider', requires_credential: true, enabled: true, feature_gaps: null },
    ]);
    store.credentials.mockReturnValue([{ provider_key: 'openai' }]);
    fixture.detectChanges();
    expect(component.optionDisabled('openai')).toBe(false);
  });

  it('auto-populates credential_ref when a provider has exactly one tenant credential', () => {
    store.credentials.mockReturnValue([{ provider_key: 'deepgram', credential_ref: 'secrets/deepgram', id: 'cred-1' }]);
    fixture.detectChanges();
    component.onSttProvider('deepgram');
    expect(store.patchDraft).toHaveBeenCalledWith({ stt: { provider: 'deepgram', credential_ref: 'secrets/deepgram' } });
  });

  it('leaves credential_ref unset (defers to the secondary dropdown) when a provider has multiple credentials', () => {
    store.credentials.mockReturnValue([
      { provider_key: 'openai', credential_ref: 'secrets/openai-1', id: 'cred-1' },
      { provider_key: 'openai', credential_ref: 'secrets/openai-2', id: 'cred-2' },
    ]);
    fixture.detectChanges();
    expect(component.hasMultipleCredentials('openai')).toBe(true);
    component.onTtsProvider('openai');
    expect(store.patchDraft).toHaveBeenCalledWith({ tts: { provider: 'openai', credential_ref: undefined } });
  });

  it('every layer field handler patches the store draft', () => {
    fixture.detectChanges();
    component.onSttProvider('deepgram');
    component.onSttField({ language: 'fr-FR' });
    component.onTtsProvider('fish-speech');
    component.onTtsVoiceId('v1');
    component.onAvatarProvider('bithuman');
    component.onAvatarId('a1');
    expect(store.patchDraft).toHaveBeenCalledTimes(6);
  });

  it('featureGapsFor surfaces the verbatim catalog copy for a documented provider gap', () => {
    const gapText = 'LiveAvatar: idle motion and custom upload may differ from bitHuman.';
    store.definitions.mockReturnValue([
      { key: 'alibaba-liveavatar', category: 'avatar', display_name: 'Alibaba LiveAvatar', hosting: 'remote', interface_name: 'IAvatarProvider', requires_credential: true, enabled: true, feature_gaps: gapText },
    ]);
    store.draft.mockReturnValue({ avatar: { provider: 'alibaba-liveavatar' } });
    fixture.detectChanges();
    expect(component.featureGapsFor('alibaba-liveavatar')).toBe(gapText);
    const note = fixture.nativeElement.querySelector('[data-testid="avatar-feature-gap"]');
    expect(note?.textContent).toContain(gapText);
  });

  it('errorsFor maps the store errorsByLayer map to message strings', () => {
    store.errorsByLayer.mockReturnValue(new Map([['stt', [{ code: 'CONFIG_INCOMPLETE', message: 'Select a provider for stt.' }]]]));
    fixture.detectChanges();
    expect(component.errorsFor('stt')).toEqual(['Select a provider for stt.']);
    expect(component.errorsFor('avatar')).toEqual([]);
  });

  it('shows a retry action when the shared draft failed to load', () => {
    store.status.mockReturnValue('error');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not load this deployment');
  });
});
