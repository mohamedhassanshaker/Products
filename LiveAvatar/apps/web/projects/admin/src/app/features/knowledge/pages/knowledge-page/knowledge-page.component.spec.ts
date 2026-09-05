import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { KnowledgeSourcesApiService, TenantsApiService } from '@liveavatar/web-shared';
import { KnowledgePageComponent } from './knowledge-page.component';

/**
 * Shell smoke test only (per the task brief — "a light smoke test, not a
 * full re-test of Sources' own logic, which already has its own spec").
 * `mat-tab-group` lazily attaches a tab's content only once it becomes the
 * active tab (`@angular/material/tabs`'s `MatTabBody._onCentered`), so only
 * the Sources tab (index 0, active by default) is actually instantiated
 * here — Pipeline/Playground's own stores/services are never touched by
 * this test and need no mocking.
 */
describe('KnowledgePageComponent', () => {
  let fixture: ComponentFixture<KnowledgePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KnowledgePageComponent, NoopAnimationsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantsApiService, useValue: { get: jest.fn(() => of({ id: 't-1', name: 'Acme' })) } },
        { provide: KnowledgeSourcesApiService, useValue: { list: jest.fn(() => of({ items: [] })) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't-1' }) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KnowledgePageComponent);
    fixture.detectChanges();
  });

  it('renders a mat-tab-group with the Sources, Pipeline, and Playground tabs', () => {
    const labels = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')).map((el) =>
      (el as HTMLElement).textContent?.trim(),
    );
    expect(labels).toEqual(['Sources', 'Pipeline', 'Playground']);
  });

  it('renders the pre-existing KnowledgeSourcesPageComponent, unchanged, as the Sources tab content', () => {
    const sourcesPage = fixture.nativeElement.querySelector('la-knowledge-sources-page');
    expect(sourcesPage).toBeTruthy();
    expect(sourcesPage.textContent).toContain('New source');
  });
});
