import { Routes } from '@angular/router';
import { guestGuard } from '../../core/auth/auth.guard';

/** Auth chrome routes (UX_GUIDELINES §1.7) — no sidenav shell. */
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login-page/login-page.component').then((m) => m.LoginPageComponent),
    title: 'Sign in · Avatar Platform',
  },
  {
    path: 'invite',
    loadComponent: () =>
      import('./pages/accept-invite-page/accept-invite-page.component').then(
        (m) => m.AcceptInvitePageComponent,
      ),
    title: 'Accept invite · Avatar Platform',
  },
];
