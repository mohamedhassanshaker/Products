import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TenantsApiService } from '@liveavatar/web-shared';
import type { RetrievalPipelineConfig } from '@liveavatar/contracts';
import { KnowledgePipelinePageComponent } from './knowledge-pipeline-page.component';
import { KnowledgePipelineStore } from '../../store/knowledge-pipeline.store';

function pipeline(overrides: Partial<RetrievalPipelineConfig> = {}): RetrievalPipelineConfig {
  return {
    rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
    hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
    metadata_filter: { enabled: false, budget_ms: 20 },
    rerank: { enabled: false },
    threshold: { min_score: 0.5, budget_ms: 10 },
    inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
    ...overrides,
  };
}

describe('KnowledgePipelinePageComponent', () => {
  let fixture: ComponentFixture<KnowledgePipelinePageComponent>;
  let component: KnowledgePipelinePageComponent;
  let store: ReturnType<typeof makeStore>;
  let tenantsApi: { get: jest.Mock };
  let snackBar: { open: jest.Mock };

  function makeStore(overrides: Record<string, jest.Mock> = {}) {
    return {
      load: jest.fn(),
      status: jest.fn(() => 'ready'),
      loadError: jest.fn(() => null),
      pipeline: jest.fn(() => pipeline()),
      retrieveNodeBudgetMs: jest.fn(() => null),
      budgetExceededErrors: jest.fn(() => []),
      staleSourceErrors: jest.fn(() => []),
      dirty: jest.fn(() => false),
      saving: jest.fn(() => null),
      canPublish: jest.fn(() => true),
      hasUnpublishedChanges: jest.fn(() => false),
      configStatus: jest.fn(() => 'draft'),
      validating: jest.fn(() => false),
      saveAlert: jest.fn(() => null),
      conflict: jest.fn(() => false),
      updateStage: jest.fn(),
      saveDraft: jest.fn(),
      publish: jest.fn(),
      reloadAfterConflict: jest.fn(),
      ...overrides,
    };
  }

  async function setup(storeOverrides: Record<string, jest.Mock> = {}) {
    store = makeStore(storeOverrides);
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [KnowledgePipelinePageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KnowledgePipelineStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgePipelinePageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('loads the pipeline store for the route tenant id', async () => {
    await setup();
    expect(store.load).toHaveBeenCalledWith('t-1');
  });

  it('renders all six pipeline stages', async () => {
    await setup();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('① Query rewrite');
    expect(text).toContain('② Hybrid search');
    expect(text).toContain('③ Metadata filter');
    expect(text).toContain('④ Rerank');
    expect(text).toContain('⑤ Threshold');
    expect(text).toContain('⑥ Inject');
  });

  it('renders hybrid search as always-on, never a togglable control', async () => {
    await setup();
    expect(fixture.nativeElement.textContent).toContain('Always on');
  });

  it('renders Rerank disabled with the "Coming soon" tag, mirroring the knowledge-source-dialog pattern', async () => {
    await setup();
    const nativeCheckbox = fixture.nativeElement.querySelector('mat-checkbox input[type="checkbox"]') as HTMLInputElement;
    expect(nativeCheckbox.disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.la-knowledge-soon').textContent).toContain('Coming soon');
  });

  it('editing the threshold min-score input calls store.updateStage with the merged stage', async () => {
    await setup();
    // Resolve the exact input defensively by matching the min="0" max="1" step="0.01" attribute combo used only by threshold.min_score.
    const thresholdInput = Array.from(fixture.nativeElement.querySelectorAll('input[type="number"]')).find(
      (el) => (el as HTMLInputElement).step === '0.01' && (el as HTMLInputElement).max === '1',
    ) as HTMLInputElement;
    expect(thresholdInput).toBeTruthy();
    thresholdInput.value = '0.8';
    thresholdInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(store.updateStage).toHaveBeenCalledWith('threshold', { min_score: 0.8, budget_ms: 10 });
  });

  it('patchStage merges the patch into the current stage before calling the store', async () => {
    await setup();
    component.patchStage('inject', { token_cap: 900 });
    expect(store.updateStage).toHaveBeenCalledWith('inject', {
      token_cap: 900,
      citation_format: 'numbered',
      budget_ms: 30,
    });
  });

  it('patchMetadataCondition fills in defaults for an absent condition', async () => {
    await setup();
    component.patchMetadataCondition({ field: 'section' });
    expect(store.updateStage).toHaveBeenCalledWith('metadata_filter', {
      enabled: false,
      budget_ms: 20,
      condition: { field: 'section', op: 'eq', value: '' },
    });
  });

  it('the running-total budget bar reflects the sum of every real stage (excluding rerank, which has none)', async () => {
    await setup();
    // 150 + 100 + 20 + 10 + 30 = 310
    expect(component.stageTotalMs()).toBe(310);
    const totalSection = fixture.nativeElement.querySelector('.la-pipeline-total');
    expect(totalSection.textContent).toContain('310ms');
  });

  it('falls back to the summed stage total as the budget denominator when no Retrieve node exists yet', async () => {
    await setup();
    expect(component.effectiveBudgetMs()).toBe(310);
    expect(fixture.nativeElement.textContent).toContain('Add a Retrieve node in the Reasoning tab');
  });

  it('uses the Retrieve node budget as the denominator when one exists', async () => {
    await setup({ retrieveNodeBudgetMs: jest.fn(() => 400) });
    expect(component.effectiveBudgetMs()).toBe(400);
    expect(fixture.nativeElement.textContent).not.toContain('Add a Retrieve node in the Reasoning tab');
  });

  it('surfaces CONFIG_RETRIEVAL_BUDGET_EXCEEDED inline at the running total, not a global banner', async () => {
    await setup({
      budgetExceededErrors: jest.fn(() => [{ code: 'CONFIG_RETRIEVAL_BUDGET_EXCEEDED', message: 'Pipeline exceeds budget.' }]),
    });
    const totalSection = fixture.nativeElement.querySelector('.la-pipeline-total');
    expect(totalSection.textContent).toContain('Pipeline exceeds budget.');
  });

  it('surfaces KNOWLEDGE_SOURCE_STALE inline at the running total', async () => {
    await setup({
      staleSourceErrors: jest.fn(() => [{ code: 'KNOWLEDGE_SOURCE_STALE', message: 'This knowledge source has not been re-indexed.' }]),
    });
    const totalSection = fixture.nativeElement.querySelector('.la-pipeline-total');
    expect(totalSection.textContent).toContain('This knowledge source has not been re-indexed.');
  });

  it('saveDraft/publish call the store with a success callback', async () => {
    await setup();
    component.saveDraft();
    expect(store.saveDraft).toHaveBeenCalledWith(expect.any(Function));
    component.publish();
    expect(store.publish).toHaveBeenCalledWith(expect.any(Function));
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    store = makeStore();
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    await TestBed.configureTestingModule({
      imports: [KnowledgePipelinePageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KnowledgePipelineStore, useValue: store },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KnowledgePipelinePageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
