import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { KnowledgeSourcesApiService, TenantsApiService } from '@liveavatar/web-shared';
import type { RunRetrievalPlaygroundResponseDto } from '@liveavatar/contracts';
import { KnowledgePlaygroundPageComponent } from './knowledge-playground-page.component';

function playgroundResult(overrides: Partial<RunRetrievalPlaygroundResponseDto> = {}): RunRetrievalPlaygroundResponseDto {
  return {
    rewrite: { enabled: true, rewritten_query: 'refund eligibility for a damaged order', ms: 118, timed_out: false },
    hybrid_search: {
      candidates: [
        {
          chunk_id: 'c-1',
          source_id: 'src-1',
          source_name: 'returns-policy',
          text_excerpt: 'Refunds are available within 30 days.',
          vector_score: 0.81,
          keyword_score: 0.74,
          blend_score: 0.78,
          passed_filter: true,
          passed_threshold: true,
        },
      ],
      ms: 58,
      timed_out: false,
    },
    filter: { enabled: true, before_count: 20, after_count: 11, ms: 4 },
    rerank: { enabled: false, note: 'Reranking is not available yet.' },
    threshold: { min_score: 0.75, pass_count: 3, dropped_count: 0, ms: 2 },
    inject: {
      chunks: [
        { citation_label: '1', source_name: 'returns-policy', text_excerpt: 'Standard refunds are available within 30 days.', token_count: 260 },
        { citation_label: '2', source_name: 'returns-policy', text_excerpt: 'Damaged goods are exempt from this limit.', token_count: 190 },
        { citation_label: '3', source_name: 'returns-policy', text_excerpt: 'Exceptions require a supervisor override.', token_count: 220 },
      ],
      token_total: 670,
      token_cap: 1200,
      ms: 3,
    },
    total_ms: 356,
    budget_ms: 400,
    over_budget: false,
    ...overrides,
  };
}

describe('KnowledgePlaygroundPageComponent', () => {
  let fixture: ComponentFixture<KnowledgePlaygroundPageComponent>;
  let component: KnowledgePlaygroundPageComponent;
  let knowledgeApi: { runRetrievalPlayground: jest.Mock };
  let tenantsApi: { get: jest.Mock };

  async function setup() {
    knowledgeApi = { runRetrievalPlayground: jest.fn() };
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };

    await TestBed.configureTestingModule({
      imports: [KnowledgePlaygroundPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KnowledgeSourcesApiService, useValue: knowledgeApi },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgePlaygroundPageComponent);
    component = fixture.componentInstance;
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('disables Run while the query is empty', async () => {
    await setup();
    expect(component.runDisabled()).toBe(true);
    component.query.set('refund after 30 days');
    expect(component.runDisabled()).toBe(false);
  });

  it('sends the query and, when present, the conversation context', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(of(playgroundResult()));
    component.query.set('refund after 30 days');
    component.conversationContext.set('caller: my order arrived broken');

    component.run();

    expect(knowledgeApi.runRetrievalPlayground).toHaveBeenCalledWith('t-1', {
      query: 'refund after 30 days',
      conversation_context: 'caller: my order arrived broken',
    });
  });

  it('omits conversation_context entirely when left blank', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(of(playgroundResult()));
    component.query.set('refund after 30 days');

    component.run();

    expect(knowledgeApi.runRetrievalPlayground).toHaveBeenCalledWith('t-1', { query: 'refund after 30 days' });
  });

  it('renders every stage section on a successful run', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(of(playgroundResult()));
    component.query.set('refund after 30 days');

    component.run();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('refund eligibility for a damaged order');
    expect(text).toContain('returns-policy');
    expect(text).toContain('0.78');
    expect(text).toContain('20 reduced to 11');
    expect(text).toContain('Reranking is not available yet.');
    expect(text).toContain('3 pass, 0 dropped');
    expect(text).toContain('670');
    expect(text).toContain('356');
  });

  it('the aria-live summary reports "<n> chunks injected, <ms>ms" and omits the candidate/chunk detail', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(of(playgroundResult()));
    component.query.set('refund after 30 days');

    component.run();
    fixture.detectChanges();

    expect(component.runSummary()).toBe('3 chunks injected, 356ms');
    // `mat-form-field`'s own subscript-wrapper divs also carry `aria-live="polite"`
    // (empty, no hint/error text) and appear earlier in the DOM, so scope the
    // query to the summary paragraph's own class, not just the attribute.
    const summaryEl = fixture.nativeElement.querySelector('p.la-playground__summary[aria-live="polite"]');
    expect(summaryEl.textContent.trim()).toBe('3 chunks injected, 356ms');
    expect(summaryEl.textContent).not.toContain('returns-policy');
  });

  it('pluralizes a single injected chunk correctly', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(
      of(playgroundResult({ inject: { chunks: [{ citation_label: '1', source_name: 'faq', text_excerpt: 'x', token_count: 10 }], token_total: 10, token_cap: 1200, ms: 1 } })),
    );
    component.query.set('q');
    component.run();
    expect(component.runSummary()).toBe('1 chunk injected, 356ms');
  });

  it('renders a pointer to the Sources tab on KNOWLEDGE_SOURCE_NOT_FOUND, not a generic error', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(
      throwError(() => ({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'Knowledge source not found.', status: 400, details: {} })),
    );
    component.query.set('refund after 30 days');

    component.run();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Sources tab');
    expect(component.running()).toBe(false);
  });

  it('renders a generic message for any other error code', async () => {
    await setup();
    knowledgeApi.runRetrievalPlayground.mockReturnValue(
      throwError(() => ({ code: 'UNKNOWN_ERROR', message: 'Something broke.', status: 500, details: {} })),
    );
    component.query.set('refund after 30 days');

    component.run();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Something broke.');
  });

  it('redirects to Deployments when tenantId is missing from the route', async () => {
    knowledgeApi = { runRetrievalPlayground: jest.fn() };
    tenantsApi = { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) };
    await TestBed.configureTestingModule({
      imports: [KnowledgePlaygroundPageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KnowledgeSourcesApiService, useValue: knowledgeApi },
        { provide: TenantsApiService, useValue: tenantsApi },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(KnowledgePlaygroundPageComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/deployments']);
  });
});
