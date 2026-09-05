import type { Routes } from '@angular/router';

/** Dashboard feature routes (Screen 1, UX_GUIDELINES §13). */
export const DASHBOARD_ROUTES: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard-page/dashboard-page.component').then((m) => m.DashboardPageComponent),
    title: 'Dashboard · Avatar Platform',
  },
];
