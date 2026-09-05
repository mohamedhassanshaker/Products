import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { DeploymentConfigApiService } from '../../api/deployment-config-api.service';
import { TestCallPanelComponent } from './test-call-panel.component';

describe('TestCallPanelComponent', () => {
  let fixture: ComponentFixture<TestCallPanelComponent>;
  let component: TestCallPanelComponent;
  let configApi: { testCall: jest.Mock };

  async function setup() {
    configApi = { testCall: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [TestCallPanelComponent, NoopAnimationsModule],
      providers: [{ provide: DeploymentConfigApiService, useValue: configApi }],
    }).compileComponents();
    fixture = TestBed.createComponent(TestCallPanelComponent);
    component = fixture.componentInstance;
    component.tenantId = 't-1';
    component.config = { version: 1 };
    fixture.detectChanges();
  }

  it('disables Run while the utterance is empty', async () => {
    await setup();
    expect(component.runDisabled()).toBe(true);
    component.utterance.set('hi');
    expect(component.runDisabled()).toBe(false);
  });

  it('calls the shared test-call endpoint with the tenant id, config, and utterance', async () => {
    await setup();
    configApi.testCall.mockReturnValue(of({ ok: true, final_text: 'hello', nodes: [], errors: [] }));
    component.utterance.set('hi there');

    component.run();

    expect(configApi.testCall).toHaveBeenCalledWith('t-1', { config: { version: 1 }, utterance: 'hi there' });
    expect(component.result()?.final_text).toBe('hello');
    expect(component.running()).toBe(false);
  });

  it('emits resultChange on success', async () => {
    await setup();
    const spy = jest.spyOn(component.resultChange, 'emit');
    configApi.testCall.mockReturnValue(of({ ok: true, final_text: null, nodes: [], errors: [] }));
    component.utterance.set('hi');

    component.run();

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('sets error and emits null on a failed call', async () => {
    await setup();
    const spy = jest.spyOn(component.resultChange, 'emit');
    configApi.testCall.mockReturnValue(throwError(() => ({ code: 'CONFIG_INVALID', message: 'Bad config.', status: 422, details: {} })));
    component.utterance.set('hi');

    component.run();

    expect(component.error()?.code).toBe('CONFIG_INVALID');
    expect(component.running()).toBe(false);
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('resultSummary reports node count and failures without re-announcing the full list', async () => {
    await setup();
    configApi.testCall.mockReturnValue(
      of({
        ok: true,
        final_text: 'hi',
        nodes: [
          { node_id: 'llm-1', node_type: 'llm', lane: 'foreground', status: 'complete', simulated: true, summary: 'x' },
          { node_id: 'end-1', node_type: 'end', lane: 'foreground', status: 'failed', simulated: false, summary: 'y' },
        ],
        errors: [],
      }),
    );
    component.utterance.set('hi');
    component.run();
    expect(component.resultSummary()).toBe('2 nodes executed, 1 failed.');
  });
});
