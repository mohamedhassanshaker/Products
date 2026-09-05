import type { Routes } from '@angular/router';

/** Session Logs feature routes (Screen 5, UX_GUIDELINES §14). */
export const SESSION_LOGS_ROUTES: Routes = [
  {
    path: 'sessions',
    loadComponent: () =>
      import('./pages/sessions-list-page/sessions-list-page.component').then((m) => m.SessionsListPageComponent),
    title: 'Sessions · Avatar Platform',
  },
  {
    path: 'sessions/:id',
    loadComponent: () =>
      import('./pages/session-detail-page/session-detail-page.component').then((m) => m.SessionDetailPageComponent),
    title: 'Session detail · Avatar Platform',
  },
];
