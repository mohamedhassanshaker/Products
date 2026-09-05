import type { Routes } from '@angular/router';

/** Alerts feature routes (Screen 7, UX_GUIDELINES §16). */
export const ALERTS_ROUTES: Routes = [
  {
    path: 'alerts',
    loadComponent: () =>
      import('./pages/alerts-picker-page/alerts-picker-page.component').then((m) => m.AlertsPickerPageComponent),
    title: 'Alerts · Avatar Platform',
  },
  {
    path: 'tenants/:id/alerts',
    loadComponent: () => import('./pages/alerts-page/alerts-page.component').then((m) => m.AlertsPageComponent),
    title: 'Alerts & failover · Avatar Platform',
  },
];
