import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PublicSessionSummary } from '@liveavatar/contracts';
import { PublicApiService, type AppClientError } from '@liveavatar/web-shared';

/**
 * Screen 11 — Post-call summary (FR-CALL-4/5, UX_GUIDELINES §18). Replaces
 * the Phase 3 "ended" placeholder. Unauthenticated, no account, no
 * `CallSessionStore` dependency (UX_GUIDELINES §18.1) — a self-contained
 * page scoped to exactly what this screen needs: the session id + one-time
 * `summary_token` carried in the route (see `app.routes.ts`'s docstring for
 * why the id is in the URL alongside the token).
 */
@Component({
  selector: 'la-conv-summary-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-page.component.html',
  styleUrl: './summary-page.component.scss',
})
export class SummaryPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly publicApi = inject(PublicApiService);
  protected readonly router = inject(Router);

  /** Focused on load for the terminal expired/not-found state (UX_GUIDELINES §18.5). */
  @ViewChild('terminalHeading') private readonly terminalHeading?: ElementRef<HTMLHeadingElement>;

  protected readonly slug = this.route.snapshot.paramMap.get('slug') ?? '';
  private readonly sessionId = this.route.snapshot.paramMap.get('sessionId') ?? '';
  private readonly summaryToken = this.route.snapshot.paramMap.get('summaryToken') ?? '';

  protected readonly loading = signal(true);
  /**
   * Both `CALL_SUMMARY_EXPIRED` and `SESSION_NOT_FOUND` collapse to this one
   * terminal flag — FR-CALL-5 requires guessing another session's token not
   * be distinguishable from an ordinary expiry (UX_GUIDELINES §18.3).
   */
  protected readonly expired = signal(false);
  /**
   * `410 TRANSCRIPT_PURGED` on the whole `GET .../summary` response (LLD
   * §5.8's exact contract — the endpoint 410s entirely, not a per-field
   * flag inside a `200`). In practice this can only occur if the daily
   * retention job's window is somehow shorter than this token's 30-minute
   * TTL, which the spec's own 1-730 day range makes effectively impossible
   * — treated as its own terminal state (distinct copy from `expired`,
   * UX_GUIDELINES §18.3) rather than building a partial-content fetch
   * strategy for a practically unreachable combination.
   */
  protected readonly purged = signal(false);
  protected readonly summary = signal<PublicSessionSummary | null>(null);

  protected readonly rating = signal(0);
  protected readonly comment = signal('');
  protected readonly submitting = signal(false);
  protected readonly feedbackSubmitted = signal(false);
  protected readonly feedbackError = signal<string | null>(null);

  protected readonly hasSummaryText = computed(() => Boolean(this.summary()?.summary_text));
  protected readonly transcript = computed(() => this.summary()?.transcript ?? null);

  constructor() {
    this.fetchSummary();

    effect(() => {
      if (this.expired() || this.purged()) {
        queueMicrotask(() => this.terminalHeading?.nativeElement.focus());
      }
    });
  }

  protected onRate(value: number): void {
    this.rating.set(value);
  }

  /**
   * QA fix (phase7-conversation-summary D-3): the star control is a
   * WAI-ARIA APG "radio group" (UX_GUIDELINES §18.5) — arrow keys move both
   * selection and focus among the five `role="radio"` options (roving
   * tabindex, set via `[attr.tabindex]` in the template), matching how a
   * screen reader/keyboard user expects a 1-of-5 radiogroup to behave,
   * rather than five independently-tabbable toggle buttons.
   */
  protected onStarsKeydown(event: KeyboardEvent): void {
    const current = this.rating() || 1;
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = Math.min(5, current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = Math.max(1, current - 1);
    } else {
      return;
    }
    event.preventDefault();
    this.onRate(next);
    const group = event.currentTarget as HTMLElement;
    queueMicrotask(() => {
      const buttons = group.querySelectorAll<HTMLButtonElement>('.la-summary__star');
      buttons[next - 1]?.focus();
    });
  }

  protected onCommentChange(value: string): void {
    this.comment.set(value.slice(0, 1000));
  }

  /** Screen 11 feedback submit (FR-CALL-4). Rating must be chosen; comment is genuinely optional. */
  protected onSubmitFeedback(): void {
    if (this.rating() < 1 || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.feedbackError.set(null);
    this.publicApi
      .submitFeedback(this.sessionId, this.summaryToken, {
        rating: this.rating(),
        comment: this.comment().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.feedbackSubmitted.set(true);
        },
        error: (error: AppClientError) => {
          this.submitting.set(false);
          // Per UX_GUIDELINES §18.3: a duplicate submit is a success-equivalent
          // outcome (the spec's own wording ends "Thank you.") — never an error banner.
          if (error.code === 'FEEDBACK_ALREADY_SUBMITTED') {
            this.feedbackSubmitted.set(true);
            return;
          }
          // A token that expired between page-load and submit collapses the
          // whole page to the same terminal state as an expired page-load
          // (UX_GUIDELINES §18.3) — the half-rendered summary/transcript are
          // not left dangling behind a broken form.
          if (error.code === 'CALL_SUMMARY_EXPIRED') {
            this.expired.set(true);
            return;
          }
          this.feedbackError.set(error.message);
        },
      });
  }

  private fetchSummary(): void {
    this.loading.set(true);
    this.publicApi.summary(this.sessionId, this.summaryToken).subscribe({
      next: (summary) => {
        this.summary.set(summary);
        // QA fix (phase7-conversation-summary D-2): initialize the
        // already-submitted state from the response's own
        // `feedback_submitted` field. Without this, reopening/reloading a
        // summary link within its TTL after feedback was already recorded
        // incorrectly re-showed the full rating form instead of the
        // required calm confirmation line (UX_GUIDELINES §18.2 step 3).
        this.feedbackSubmitted.set(summary.feedback_submitted);
        this.loading.set(false);
      },
      error: (error: AppClientError) => {
        if (error.status === 410) {
          this.purged.set(true);
        } else {
          // CALL_SUMMARY_EXPIRED and SESSION_NOT_FOUND both land here — same
          // terminal, non-disclosing treatment either way (FR-CALL-5).
          this.expired.set(true);
        }
        this.loading.set(false);
      },
    });
  }
}
