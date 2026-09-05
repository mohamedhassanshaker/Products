import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { AppClientError } from '@liveavatar/web-shared';
import { LoginPageComponent } from './login-page.component';
import { AuthStore } from '../../../../core/auth/auth.store';

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let component: LoginPageComponent;
  let authStore: { login: jest.Mock };
  let router: Router;

  async function setup(queryParams: Record<string, string> = {}) {
    authStore = { login: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: authStore },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();
  }

  afterEach(() => jest.useRealTimers());

  it('disables submit until both fields are non-empty', async () => {
    await setup();
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.email.setValue('a@b.com');
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.password.setValue('secret1');
    expect(component.submitDisabled()).toBe(false);
  });

  it('shows AUTH_EMAIL_INVALID sentence on blur for a malformed email', async () => {
    await setup();
    component.form.controls.email.setValue('not-an-email');
    component.onEmailBlur();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Enter a valid email address.');
  });

  it('does not call the API for a malformed email on submit', async () => {
    await setup();
    component.form.controls.email.setValue('not-an-email');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(authStore.login).not.toHaveBeenCalled();
  });

  it('logs in and navigates to the default landing route on success', async () => {
    await setup();
    authStore.login.mockReturnValue(of({}));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(authStore.login).toHaveBeenCalledWith({ email: 'op@example.com', password: 'secret1' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/deployments');
  });

  it('honors a safe returnUrl query param', async () => {
    await setup({ returnUrl: '/tenants/123/builder' });
    authStore.login.mockReturnValue(of({}));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tenants/123/builder');
  });

  it('ignores an unsafe returnUrl and falls back to the default landing route', async () => {
    await setup({ returnUrl: 'https://evil.example.com' });
    authStore.login.mockReturnValue(of({}));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/deployments');
  });

  it('shows the AUTH_INVALID_CREDENTIALS sentence as a form alert', async () => {
    await setup();
    const error: AppClientError = {
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
      details: {},
    };
    authStore.login.mockReturnValue(throwError(() => error));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('wrong');
    component.onSubmit();
    fixture.detectChanges();
    expect(component.formError()).toBe('Email or password is incorrect.');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Email or password is incorrect.',
    );
  });

  it('shows the AUTH_USER_DISABLED sentence and leaves submit available', async () => {
    await setup();
    const error: AppClientError = {
      status: 403,
      code: 'AUTH_USER_DISABLED',
      message: 'This account is disabled. Contact an operator.',
      details: {},
    };
    authStore.login.mockReturnValue(throwError(() => error));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(component.formError()).toBe('This account is disabled. Contact an operator.');
    expect(component.submitDisabled()).toBe(false);
  });

  it('disables submit for 30s after AUTH_RATE_LIMITED and re-enables after the cooldown', async () => {
    jest.useFakeTimers();
    await setup();
    const error: AppClientError = {
      status: 429,
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many login attempts. Try again in a few minutes.',
      details: {},
    };
    authStore.login.mockReturnValue(throwError(() => error));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();

    expect(component.submitDisabled()).toBe(true);
    jest.advanceTimersByTime(30_000);
    expect(component.submitDisabled()).toBe(false);
  });

  it('shows a generic transport message on network/5xx errors', async () => {
    await setup();
    const error: AppClientError = { status: 0, code: 'NETWORK_ERROR', message: 'Network error.', details: {} };
    authStore.login.mockReturnValue(throwError(() => error));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(component.formError()).toBe('Sign in failed. Check your connection and try again.');
  });

  it('shows a session-expiry banner when arriving with reason=AUTH_REFRESH_INVALID', async () => {
    await setup({ reason: 'AUTH_REFRESH_INVALID' });
    expect(component.sessionBanner()).toBe('Session expired. Sign in again.');
  });

  it('does nothing and marks fields touched when submit is called while disabled', async () => {
    await setup();
    component.onSubmit();
    expect(authStore.login).not.toHaveBeenCalled();
    expect(component.form.controls.email.touched).toBe(true);
    expect(component.form.controls.password.touched).toBe(true);
  });

  it('shows AUTH_EMAIL_INVALID as a field error returned from the server', async () => {
    await setup();
    const error: AppClientError = {
      status: 400,
      code: 'AUTH_EMAIL_INVALID',
      message: 'Enter a valid email address.',
      details: {},
    };
    authStore.login.mockReturnValue(throwError(() => error));
    component.form.controls.email.setValue('op@example.com');
    component.form.controls.password.setValue('secret1');
    component.onSubmit();
    expect(component.form.controls.email.getError('server')).toBe('Enter a valid email address.');
    expect(component.form.controls.email.touched).toBe(true);
  });

  it('focuses the email field on first paint (UX_GUIDELINES §2.2, D-1)', async () => {
    await setup();
    // ngAfterViewInit queues the focus() call in a microtask; flush it.
    await Promise.resolve();
    const emailInput: HTMLInputElement = fixture.nativeElement.querySelector('input[formcontrolname="email"]');
    expect(document.activeElement).toBe(emailInput);
  });

  it('toggles password visibility', async () => {
    await setup();
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);
  });
});
