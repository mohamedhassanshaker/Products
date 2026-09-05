import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { messageForCode } from '@liveavatar/contracts';
import type { AppClientError } from '@liveavatar/web-shared';
import { AuthStore } from '../../../../core/auth/auth.store';

/** Loose RFC-5322-ish shape check — the server is authoritative; this only avoids an obviously bad submit. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-origin admin paths are honored; anything else falls back to the default landing route. */
function isSafeReturnUrl(value: string | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//') && !value.includes('://');
}

const RATE_LIMIT_COOLDOWN_SECONDS = 30;

/** Login screen (FR-AUTH-1/2, UX_GUIDELINES §2). */
@Component({
  selector: 'la-login-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-page.component.html',
  styleUrl: '../auth-card.scss',
})
export class LoginPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Backs UX_GUIDELINES §2.2 ("Default: Email focused on first paint").
   * The template's native `autofocus` attribute alone is not reliable across
   * every browser once Angular has finished bootstrapping/hydrating the DOM
   * (D-1), so `ngAfterViewInit` explicitly focuses the element as well —
   * belt-and-suspenders, not a replacement for the attribute.
   */
  @ViewChild('emailInput') private readonly emailInput?: ElementRef<HTMLInputElement>;

  readonly form = this.fb.group({
    email: this.fb.control('', { validators: [Validators.required] }),
    password: this.fb.control('', { validators: [Validators.required] }),
  });

  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly sessionBanner = signal<string | null>(null);
  readonly rateLimited = signal(false);
  readonly showPassword = signal(false);

  /**
   * Plain method, not a `computed()`: reading `FormControl.value` does not
   * register as a signal dependency, so a computed() here would freeze
   * after its first read. The template re-evaluates this every check.
   */
  submitDisabled(): boolean {
    const email = this.form.controls.email.value;
    const password = this.form.controls.password.value;
    return !email || !password || this.submitting() || this.rateLimited();
  }

  private returnUrl = '/deployments';
  private rateLimitTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const rawReturnUrl = params.get('returnUrl');
    this.returnUrl = isSafeReturnUrl(rawReturnUrl) ? rawReturnUrl : '/deployments';

    const reason = params.get('reason');
    if (reason === 'AUTH_REFRESH_INVALID' || reason === 'AUTH_UNAUTHORIZED') {
      this.sessionBanner.set(messageForCode(reason));
    }
  }

  ngAfterViewInit(): void {
    // Queue a microtask so this runs after Angular's own change-detection
    // pass settles, avoiding an ExpressionChangedAfterItHasBeenCheckedError
    // in dev mode from focusing during the initial view-init check.
    queueMicrotask(() => this.emailInput?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    clearTimeout(this.rateLimitTimer);
  }

  onEmailBlur(): void {
    const control = this.form.controls.email;
    control.markAsTouched();
    const value = control.value.trim();
    if (value && !EMAIL_PATTERN.test(value)) {
      control.setErrors({ ...control.errors, emailFormat: true });
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    const email = this.form.controls.email.value.trim();
    const password = this.form.controls.password.value;

    if (!EMAIL_PATTERN.test(email)) {
      this.form.controls.email.setErrors({ emailFormat: true });
      this.form.controls.email.markAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formError.set(null);
    this.sessionBanner.set(null);

    this.authStore.login({ email, password }).subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigateByUrl(this.returnUrl);
      },
      error: (error: AppClientError) => {
        this.submitting.set(false);
        this.handleError(error);
      },
    });
  }

  private handleError(error: AppClientError): void {
    switch (error.code) {
      case 'AUTH_EMAIL_INVALID':
        this.form.controls.email.setErrors({ server: error.message });
        this.form.controls.email.markAsTouched();
        break;
      case 'AUTH_INVALID_CREDENTIALS':
      case 'AUTH_USER_DISABLED':
        this.formError.set(error.message);
        break;
      case 'AUTH_RATE_LIMITED':
        this.formError.set(error.message);
        this.startRateLimitCooldown();
        break;
      default:
        this.formError.set('Sign in failed. Check your connection and try again.');
    }
  }

  private startRateLimitCooldown(seconds = RATE_LIMIT_COOLDOWN_SECONDS): void {
    this.rateLimited.set(true);
    clearTimeout(this.rateLimitTimer);
    this.rateLimitTimer = setTimeout(() => this.rateLimited.set(false), seconds * 1000);
  }
}
