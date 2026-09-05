import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { ShellComponent } from './core/layout/shell.component';
import { AUTH_ROUTES } from './features/auth/auth.routes';
import { DEPLOYMENTS_ROUTES } from './features/deployments/deployments.routes';
import { PROVIDER_REGISTRY_ROUTES } from './features/provider-registry/provider-registry.routes';
import { AGENT_BUILDER_LEGACY_REDIRECTS, AGENT_BUILDER_ROUTES } from './features/agent-builder/agent-builder.routes';
import { DASHBOARD_ROUTES } from './features/dashboard/dashboard.routes';
import { SESSION_LOGS_ROUTES } from './features/session-logs/session-logs.routes';
import { GPU_ROUTES } from './features/gpu/gpu.routes';
import { ALERTS_ROUTES } from './features/alerts/alerts.routes';
import { RESIDENCY_ROUTES } from './features/residency/residency.routes';
import { REVIEWER_CONSOLE_ROUTES } from './features/reviewer-console/reviewer-console.routes';

/**
 * Admin SPA route map (UX_GUIDELINES §1.7). Phase 7 (BL-020..024) replaced
 * every remaining "coming soon" placeholder with its real screen. Phase 16
 * (BL-065, "Builder consolidation") removed the six standalone tab routes
 * Tools/Reasoning/Knowledge/Skills/HITL used to register here directly
 * (`TOOLS_ROUTES`/etc. — their route files were deleted) in favor of
 * `AGENT_BUILDER_ROUTES`'s nested children, plus `AGENT_BUILDER_LEGACY_REDIRECTS`
 * so every one of those old paths still resolves (`docs/v2/UX_SCOPE.md`
 * "old routes must keep working"). `RESIDENCY_ROUTES` keeps only the
 * tenant-less `residency` picker now — its old `tenants/:id/residency` entry
 * is one of the redirected paths (-> `.../builder/privacy`).
 */
export const routes: Routes = [
  ...AUTH_ROUTES,
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      ...DASHBOARD_ROUTES,
      ...DEPLOYMENTS_ROUTES,
      ...PROVIDER_REGISTRY_ROUTES,
      ...AGENT_BUILDER_ROUTES,
      ...SESSION_LOGS_ROUTES,
      ...GPU_ROUTES,
      ...ALERTS_ROUTES,
      ...RESIDENCY_ROUTES,
      ...REVIEWER_CONSOLE_ROUTES,
      ...AGENT_BUILDER_LEGACY_REDIRECTS,
      { path: '', pathMatch: 'full' as const, redirectTo: 'deployments' },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
