import type { Routes } from '@angular/router';

/**
 * Residency feature routes (Screen 8, UX_GUIDELINES §17). The tenant-scoped
 * `tenants/:id/residency` route this used to also register here moved under
 * the Agent Builder shell in Phase 16 (BL-064, `docs/v2/UX_SCOPE.md`
 * "Privacy tab: relabel/relocate the existing standalone Residency screen")
 * — see `agent-builder.routes.ts`'s `privacy` child route (the live
 * mount, `ResidencyPageComponent` unchanged) and `AGENT_BUILDER_LEGACY_REDIRECTS`
 * (the old path's redirect). The bare, tenant-less `residency` *picker*
 * below is explicitly **not** part of that consolidation
 * (`docs/v2/AgentBuilder_...HITL.md`'s Phase 16 scope note) and is
 * untouched.
 */
export const RESIDENCY_ROUTES: Routes = [
  {
    path: 'residency',
    loadComponent: () =>
      import('./pages/residency-picker-page/residency-picker-page.component').then((m) => m.ResidencyPickerPageComponent),
    title: 'Residency · Avatar Platform',
  },
];
