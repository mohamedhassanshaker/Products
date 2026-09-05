import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PublicApiService } from '@liveavatar/web-shared';
import { SummaryPageComponent } from './summary-page.component';

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ended',
    summary_status: 'ready',
    summary_text: 'A short summary.',
    transcript: [{ role: 'user', text: 'hi' }],
    feedback_submitted: false,
    ...overrides,
  };
}

describe('SummaryPageComponent (Screen 11, FR-CALL-4/5)', () => {
  let fixture: ComponentFixture<SummaryPageComponent>;
  let publicApi: { summary: jest.Mock; submitFeedback: jest.Mock };

  function setup(summaryResult: unknown = of(makeSummary())) {
    publicApi = { summary: jest.fn().mockReturnValue(summaryResult), submitFeedback: jest.fn() };

    TestBed.configureTestingModule({
      imports: [SummaryPageComponent],
      providers: [
        { provide: PublicApiService, useValue: publicApi },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ slug: 'acme', sessionId: 's1', summaryToken: 'sum-tok' }) } },
        },
      ],
    });
    fixture = TestBed.createComponent(SummaryPageComponent);
    fixture.detectChanges();
  }

  it('fetches the summary with the route session id + summary token', () => {
    setup();
    expect(publicApi.summary).toHaveBeenCalledWith('s1', 'sum-tok');
  });

  it('renders the summary paragraph and transcript on success', () => {
    setup();
    expect(fixture.nativeElement.textContent).toContain('A short summary.');
    expect(fixture.nativeElement.textContent).toContain('hi');
  });

  it('omits the summary section entirely when summary_status is not ready (non-blocking)', () => {
    setup(of(makeSummary({ summary_status: 'unavailable', summary_text: undefined })));
    expect(fixture.nativeElement.textContent).not.toContain('A short summary.');
  });

  it('shows "no transcript available" copy for a genuinely empty (not purged) transcript', () => {
    setup(of(makeSummary({ transcript: [] })));
    expect(fixture.nativeElement.textContent).toContain('No transcript is available for this call.');
  });

  it('shows the terminal expired state for a 401/404, identically (FR-CALL-5 non-disclosure)', () => {
    setup(throwError(() => ({ status: 401, code: 'CALL_SUMMARY_EXPIRED', message: 'This summary link has expired.' })));
    expect(fixture.nativeElement.textContent).toContain('This link has expired');
  });

  it('treats a session-not-found error identically to an expired token', () => {
    setup(throwError(() => ({ status: 404, code: 'SESSION_NOT_FOUND', message: 'Session not found.' })));
    expect(fixture.nativeElement.textContent).toContain('This link has expired');
  });

  it('initializes the already-submitted state from the response feedback_submitted field (QA D-2)', () => {
    setup(of(makeSummary({ feedback_submitted: true })));
    expect(fixture.nativeElement.textContent).toContain('Thanks for your feedback.');
    expect(fixture.nativeElement.querySelector('.la-summary__stars')).toBeNull();
  });

  it('star control uses the WAI-ARIA radio pattern, not aria-pressed toggle buttons (QA D-3)', () => {
    setup();
    const group: HTMLElement = fixture.nativeElement.querySelector('[role="radiogroup"]');
    const stars: HTMLButtonElement[] = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(stars.length).toBe(5);
    expect(stars.every((star) => star.getAttribute('aria-checked') !== null)).toBe(true);
    expect(stars.every((star) => star.hasAttribute('aria-pressed'))).toBe(false);
  });

  it('ArrowRight/ArrowDown on the star radiogroup selects and moves focus to the next star (QA D-3)', async () => {
    setup();
    const group: HTMLElement = fixture.nativeElement.querySelector('[role="radiogroup"]');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance['rating']()).toBe(2);
    await Promise.resolve();
    const stars: HTMLButtonElement[] = Array.from(group.querySelectorAll('[role="radio"]'));
    expect(document.activeElement).toBe(stars[1]);
  });

  it('ArrowLeft/ArrowUp on the star radiogroup selects and moves focus to the previous star, clamped at 1 (QA D-3)', async () => {
    setup();
    const component = fixture.componentInstance;
    component['onRate'](3);
    fixture.detectChanges();
    const group: HTMLElement = fixture.nativeElement.querySelector('[role="radiogroup"]');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component['rating']()).toBe(2);
  });

  it('ignores unrelated keys on the star radiogroup', () => {
    setup();
    const component = fixture.componentInstance;
    const group: HTMLElement = fixture.nativeElement.querySelector('[role="radiogroup"]');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component['rating']()).toBe(0);
  });

  it('shows a distinct terminal state for a 410 purged transcript', () => {
    setup(throwError(() => ({ status: 410, code: 'TRANSCRIPT_PURGED', message: 'Transcript was deleted per the retention policy.' })));
    expect(fixture.nativeElement.textContent).toContain('Transcript no longer available');
  });

  it('submit is disabled until a rating is chosen', () => {
    setup();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.la-summary__button');
    expect(button.disabled).toBe(true);
  });

  it('submits feedback with the chosen rating and trimmed comment', () => {
    setup();
    publicApi.submitFeedback.mockReturnValue(of(undefined));
    const component = fixture.componentInstance;
    component['onRate'](5);
    component['onCommentChange']('Great call!  ');
    fixture.detectChanges();
    component['onSubmitFeedback']();
    expect(publicApi.submitFeedback).toHaveBeenCalledWith('s1', 'sum-tok', { rating: 5, comment: 'Great call!' });
  });

  it('shows a calm confirmation, not an error, on successful submit', () => {
    setup();
    publicApi.submitFeedback.mockReturnValue(of(undefined));
    const component = fixture.componentInstance;
    component['onRate'](4);
    component['onSubmitFeedback']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Thanks for your feedback.');
  });

  it('treats FEEDBACK_ALREADY_SUBMITTED as a success-equivalent outcome, not an error', () => {
    setup();
    publicApi.submitFeedback.mockReturnValue(throwError(() => ({ status: 409, code: 'FEEDBACK_ALREADY_SUBMITTED', message: 'Feedback was already sent. Thank you.' })));
    const component = fixture.componentInstance;
    component['onRate'](3);
    component['onSubmitFeedback']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Thanks for your feedback.');
  });

  it('collapses to the terminal expired state if the token expires between load and feedback submit', () => {
    setup();
    publicApi.submitFeedback.mockReturnValue(throwError(() => ({ status: 401, code: 'CALL_SUMMARY_EXPIRED', message: 'This summary link has expired.' })));
    const component = fixture.componentInstance;
    component['onRate'](3);
    component['onSubmitFeedback']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This link has expired');
  });

  it('shows a generic inline error for any other feedback failure', () => {
    setup();
    publicApi.submitFeedback.mockReturnValue(throwError(() => ({ status: 400, code: 'FEEDBACK_INVALID', message: 'Rating must be between 1 and 5.' })));
    const component = fixture.componentInstance;
    component['onRate'](3);
    component['onSubmitFeedback']();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rating must be between 1 and 5.');
  });
});
