import type { Routes } from '@angular/router';

/**
 * Conversation SPA routes (LLD §3.2, UX_GUIDELINES §11.1/§12.3/§18.1):
 * `/c/:slug` (Screen 9, entry point), `/c/:slug/call` (Screen 10), and
 * `/c/:slug/summary/:sessionId/:summaryToken` (Screen 11, Phase 7/BL-025 —
 * supersedes the Phase 3 "ended" stand-in, which is removed). There is no
 * other *meaningful* route — this SPA has no nav. The session id is carried
 * in the route alongside the one-time `summary_token` (UX_GUIDELINES §18.2
 * step 2's own contingency: "if implementation needs the id in the route
 * for some technical reason, summary_token remains the sole authorization
 * credential regardless of what's visible in the URL") — the backend's
 * `GET /public/sessions/{id}/summary` contract requires the id path param,
 * so this is a technical necessity, not a design choice; FR-CALL-5 is still
 * enforced entirely server-side by the token, never by the id's obscurity.
 *
 * The wildcard `**` route below is the one addition to that: the bare app
 * root (no slug at all, e.g. a shared link with the slug segment dropped)
 * matches nothing above and rendered a fully blank page with zero feedback
 * — a minimal dead-end explaining that, not a step toward giving this SPA
 * real navigation.
 */
export const routes: Routes = [
  {
    path: ':slug',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/precall/pages/precall-page/precall-page.component').then((m) => m.PrecallPageComponent),
      },
      {
        path: 'call',
        loadComponent: () => import('./features/call/pages/call-page/call-page.component').then((m) => m.CallPageComponent),
      },
      {
        path: 'summary/:sessionId/:summaryToken',
        loadComponent: () =>
          import('./features/summary/pages/summary-page/summary-page.component').then((m) => m.SummaryPageComponent),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/no-tenant/pages/no-tenant-page/no-tenant-page.component').then((m) => m.NoTenantPageComponent),
  },
];
