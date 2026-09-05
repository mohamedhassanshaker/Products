import type { Routes } from '@angular/router';

/**
 * Reviewer console routes (Phase 14, BL-052..057 — `docs/v2/UX_SCOPE.md`
 * "HITL tab + Reviewer console"). A separate top-level feature from
 * `features/hitl/` — reviewers are often a different persona than the
 * tenant admin who configures gates, so this gets its own nav entry and
 * its own tenant-picker funnel, mirroring `features/alerts/`'s
 * picker-page + tenant-scoped-page pair exactly.
 */
export const REVIEWER_CONSOLE_ROUTES: Routes = [
  {
    path: 'approvals',
    loadComponent: () =>
      import('./pages/approvals-picker-page/approvals-picker-page.component').then((m) => m.ApprovalsPickerPageComponent),
    title: 'Approvals · Avatar Platform',
  },
  {
    path: 'tenants/:id/approvals',
    loadComponent: () =>
      import('./pages/reviewer-console-page/reviewer-console-page.component').then((m) => m.ReviewerConsolePageComponent),
    title: 'Approvals · Avatar Platform',
  },
];
