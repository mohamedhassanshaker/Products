import { ChangeDetectionStrategy, Component, ElementRef, OnInit, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EmptyStateComponent, type AppClientError } from '@liveavatar/web-shared';
import { AuthStore } from '../../../../core/auth/auth.store';

/** Mirrors the API's password rule (≥8 chars, ≥1 letter, ≥1 digit — LLD §5). */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/** Invite-accept screen (FR-AUTH-3, UX_GUIDELINES §3). */
@Component({
  selector: 'la-accept-invite-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    EmptyStateComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accept-invite-page.component.html',
  styleUrl: '../auth-card.scss',
})
export class AcceptInvitePageComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly form = this.fb.group({
    password: this.fb.control(''),
    confirmPassword: this.fb.control(''),
  });

  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly tokenInvalid = signal(false);
  readonly emailExists = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  private token = '';

  /**
   * Plain method, not `computed()`: reading `FormControl.value` does not
   * register as a signal dependency, so a computed() would freeze after its
   * first read. The template re-evaluates this on every check.
   */
  submitDisabled(): boolean {
    const password = this.form.controls.password.value;
    const confirm = this.form.controls.confirmPassword.value;
    return this.submitting() || !PASSWORD_RULE.test(password) || password !== confirm;
  }

  constructor() {
    // `queueMicrotask` (rather than `afterNextRender`, which requires an
    // injection context not available from inside an `effect` callback)
    // waits one tick so the empty-state's heading has rendered before we
    // focus it (WCAG 3.3.2 — screen readers should not land in a missing
    // form when the invite link is invalid).
    effect(() => {
      if (this.tokenInvalid()) {
        queueMicrotask(() => {
          const title = this.elementRef.nativeElement.querySelector('.la-empty-state__title');
          (title as HTMLElement | null)?.focus();
        });
      }
    });
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.tokenInvalid.set(true);
    }
  }

  passwordRuleFailed(): boolean {
    const control = this.form.controls.password;
    return control.touched && !PASSWORD_RULE.test(control.value);
  }

  passwordsMismatch(): boolean {
    const confirm = this.form.controls.confirmPassword;
    return confirm.touched && confirm.value.length > 0 && confirm.value !== this.form.controls.password.value;
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  onSubmit(): void {
    if (this.submitDisabled()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formError.set(null);
    this.emailExists.set(false);

    this.authStore.acceptInvite({ token: this.token, password: this.form.controls.password.value }).subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigateByUrl('/deployments');
      },
      error: (error: AppClientError) => {
        this.submitting.set(false);
        this.handleError(error);
      },
    });
  }

  goToLogin(): void {
    void this.router.navigate(['/login']);
  }

  private handleError(error: AppClientError): void {
    switch (error.code) {
      case 'AUTH_INVITE_INVALID':
        this.tokenInvalid.set(true);
        break;
      case 'AUTH_EMAIL_EXISTS':
        this.emailExists.set(true);
        this.formError.set(error.message);
        break;
      default:
        this.formError.set('Could not activate this invite. Check your connection and try again.');
    }
  }
}
