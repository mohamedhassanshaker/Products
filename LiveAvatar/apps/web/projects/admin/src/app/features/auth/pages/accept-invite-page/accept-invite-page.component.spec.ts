import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import type { AppClientError } from '@liveavatar/web-shared';
import { AcceptInvitePageComponent } from './accept-invite-page.component';
import { AuthStore } from '../../../../core/auth/auth.store';

describe('AcceptInvitePageComponent', () => {
  let fixture: ComponentFixture<AcceptInvitePageComponent>;
  let component: AcceptInvitePageComponent;
  let authStore: { acceptInvite: jest.Mock };
  let router: Router;

  async function setup(token: string | null) {
    authStore = { acceptInvite: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [AcceptInvitePageComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthStore, useValue: authStore },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcceptInvitePageComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  }

  it('treats a missing token as AUTH_INVITE_INVALID with no request', async () => {
    await setup(null);
    fixture.detectChanges();
    expect(component.tokenInvalid()).toBe(true);
    expect(authStore.acceptInvite).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('This invite link is invalid or has expired.');
  });

  it('disables submit until the password rule is met and passwords match', async () => {
    await setup('tok-1');
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.password.setValue('password1');
    expect(component.submitDisabled()).toBe(true);
    component.form.controls.confirmPassword.setValue('password1');
    expect(component.submitDisabled()).toBe(false);
  });

  it('flags a mismatch between password and confirm password', async () => {
    await setup('tok-1');
    component.form.controls.password.setValue('password1');
    component.form.controls.confirmPassword.setValue('different1');
    component.form.controls.confirmPassword.markAsTouched();
    expect(component.passwordsMismatch()).toBe(true);
  });

  it('accepts the invite and navigates to /deployments on success', async () => {
    await setup('tok-1');
    authStore.acceptInvite.mockReturnValue(of({}));
    component.form.controls.password.setValue('password1');
    component.form.controls.confirmPassword.setValue('password1');
    component.onSubmit();
    expect(authStore.acceptInvite).toHaveBeenCalledWith({ token: 'tok-1', password: 'password1' });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/deployments');
  });

  it('replaces the form with the invalid-token empty-state on AUTH_INVITE_INVALID from the server', async () => {
    await setup('tok-1');
    const error: AppClientError = {
      status: 400,
      code: 'AUTH_INVITE_INVALID',
      message: 'This invite link is invalid or has expired.',
      details: {},
    };
    authStore.acceptInvite.mockReturnValue(throwError(() => error));
    component.form.controls.password.setValue('password1');
    component.form.controls.confirmPassword.setValue('password1');
    component.onSubmit();
    fixture.detectChanges();
    expect(component.tokenInvalid()).toBe(true);
  });

  it('shows AUTH_EMAIL_EXISTS as a form alert with a Sign in action', async () => {
    await setup('tok-1');
    const error: AppClientError = {
      status: 409,
      code: 'AUTH_EMAIL_EXISTS',
      message: 'An admin with this email already exists.',
      details: {},
    };
    authStore.acceptInvite.mockReturnValue(throwError(() => error));
    component.form.controls.password.setValue('password1');
    component.form.controls.confirmPassword.setValue('password1');
    component.onSubmit();
    fixture.detectChanges();
    expect(component.emailExists()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('An admin with this email already exists.');
  });

  it('shows a generic transport message on network/5xx errors', async () => {
    await setup('tok-1');
    const error: AppClientError = { status: 0, code: 'NETWORK_ERROR', message: 'Network error.', details: {} };
    authStore.acceptInvite.mockReturnValue(throwError(() => error));
    component.form.controls.password.setValue('password1');
    component.form.controls.confirmPassword.setValue('password1');
    component.onSubmit();
    expect(component.formError()).toBe('Could not activate this invite. Check your connection and try again.');
  });

  it('toggles password and confirm-password visibility', async () => {
    await setup('tok-1');
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);

    expect(component.showConfirmPassword()).toBe(false);
    component.toggleConfirmPasswordVisibility();
    expect(component.showConfirmPassword()).toBe(true);
  });

  it('does nothing and marks fields touched when submit is called while disabled', async () => {
    await setup('tok-1');
    component.onSubmit();
    expect(authStore.acceptInvite).not.toHaveBeenCalled();
    expect(component.form.controls.password.touched).toBe(true);
  });

  it('goToLogin navigates to /login', async () => {
    await setup('tok-1');
    component.goToLogin();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
