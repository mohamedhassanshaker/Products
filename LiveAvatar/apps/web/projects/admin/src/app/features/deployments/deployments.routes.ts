import { Routes } from '@angular/router';

/**
 * Deployments feature routes (Screen 3, UX_GUIDELINES §1.7/§5). The Phase-1
 * `tenants/:id/builder` placeholder route is superseded by the real Agent
 * Builder feature (`AGENT_BUILDER_ROUTES`, Phase 2) — see app.routes.ts.
 */
export const DEPLOYMENTS_ROUTES: Routes = [
  {
    path: 'deployments',
    loadComponent: () =>
      import('./pages/deployments-list-page/deployments-list-page.component').then(
        (m) => m.DeploymentsListPageComponent,
      ),
    title: 'Deployments · Avatar Platform',
  },
];
