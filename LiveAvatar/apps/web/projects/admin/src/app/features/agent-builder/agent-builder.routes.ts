import { Routes } from '@angular/router';

/**
 * Agent Builder shell routes (Phase 16, BL-065 — `docs/v2/UX_SCOPE.md`
 * "Builder consolidation", the final phase of the v2 roadmap). Replaces the
 * old single `tenants/:id/builder` route (`AgentBuilderPageComponent`,
 * decommissioned this phase) and every standalone tab route built in
 * Phases 8-15 (Tools/Reasoning/Knowledge/Skills/HITL/Residency) with one
 * `BuilderShellComponent` mounted at the same base path, nesting each tab as
 * a child route so every tab stays independently linkable (deep links,
 * browser back button) — `paramsInheritanceStrategy: 'always'`
 * (`app.config.ts`) is what lets each embedded existing-feature page keep
 * reading `route.snapshot.paramMap.get('id')` unchanged despite now being
 * nested one level deeper than when it was its own top-level route.
 *
 * Tab order matches A9.1's table (`docs/v2/UX_SCOPE.md`'s IA line): Overview,
 * Pipeline, Reasoning, Skills, Tools, Knowledge, Dynamics, HITL, Privacy.
 * Skills' `:skillId` detail and HITL's `reviewer-groups` sub-screen are
 * nested one level deeper still, under their own tab's path segment, the
 * same list -> detail shape those two already had as standalone routes.
 */
export const AGENT_BUILDER_ROUTES: Routes = [
  {
    path: 'tenants/:id/builder',
    loadComponent: () => import('./pages/builder-shell/builder-shell.component').then((m) => m.BuilderShellComponent),
    title: 'Agent Builder · Avatar Platform',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        loadComponent: () => import('./pages/overview-tab/overview-tab.component').then((m) => m.OverviewTabComponent),
        title: 'Overview · Agent Builder · Avatar Platform',
      },
      {
        path: 'pipeline',
        loadComponent: () => import('./pages/pipeline-tab/pipeline-tab.component').then((m) => m.PipelineTabComponent),
        title: 'Pipeline · Agent Builder · Avatar Platform',
      },
      {
        path: 'reasoning',
        loadComponent: () =>
          import('../reasoning/pages/reasoning-page/reasoning-page.component').then((m) => m.ReasoningPageComponent),
        title: 'Reasoning · Avatar Platform',
      },
      {
        path: 'skills',
        loadComponent: () =>
          import('../skills/pages/skills-library-page/skills-library-page.component').then((m) => m.SkillsLibraryPageComponent),
        title: 'Skills · Avatar Platform',
      },
      {
        path: 'skills/:skillId',
        loadComponent: () =>
          import('../skills/pages/skill-editor-page/skill-editor-page.component').then((m) => m.SkillEditorPageComponent),
        title: 'Skill · Avatar Platform',
      },
      {
        path: 'tools',
        loadComponent: () => import('../tools/pages/tools-page/tools-page.component').then((m) => m.ToolsPageComponent),
        title: 'Tools · Avatar Platform',
      },
      {
        path: 'knowledge',
        loadComponent: () =>
          import('../knowledge/pages/knowledge-page/knowledge-page.component').then((m) => m.KnowledgePageComponent),
        title: 'Knowledge · Avatar Platform',
      },
      {
        path: 'dynamics',
        loadComponent: () => import('./pages/dynamics-tab/dynamics-tab.component').then((m) => m.DynamicsTabComponent),
        title: 'Dynamics · Agent Builder · Avatar Platform',
      },
      {
        path: 'hitl',
        loadComponent: () =>
          import('../hitl/pages/hitl-gates-page/hitl-gates-page.component').then((m) => m.HitlGatesPageComponent),
        title: 'HITL · Avatar Platform',
      },
      {
        path: 'hitl/reviewer-groups',
        loadComponent: () =>
          import('../hitl/pages/reviewer-groups-page/reviewer-groups-page.component').then((m) => m.ReviewerGroupsPageComponent),
        title: 'Reviewer groups · Avatar Platform',
      },
      {
        // Privacy tab (BL-064): relabel/relocate only — the existing
        // Residency screen mounted directly, no new logic. Not wrapped in a
        // new `features/privacy/` (or re-exported from `features/residency/`)
        // because `ResidencyPageComponent` is already fully self-contained
        // (own header, own tenant fetch, own save) exactly like every other
        // embedded tab here — see `knowledge-page.component.ts`'s "own
        // header, own back-link" convention this follows.
        path: 'privacy',
        loadComponent: () =>
          import('../residency/pages/residency-page/residency-page.component').then((m) => m.ResidencyPageComponent),
        title: 'Privacy · Avatar Platform',
      },
    ],
  },
];

/**
 * Every pre-Phase-16 standalone route this shell absorbs, redirected to its
 * new nested location so an old bookmark or external link still resolves
 * (`docs/v2/UX_SCOPE.md` "old routes must keep working"). Angular's router
 * substitutes a `redirectTo` string's own `:param` tokens from the matched
 * URL, so `:id` here carries through unchanged. Internal `routerLink`s
 * inside the six absorbed features were updated to the new nested paths
 * directly (grepped across the admin app) rather than relying solely on
 * these redirects — see the plan doc's Phase 16 verification notes.
 *
 * The tenant-less `residency` picker route and the fully-separate
 * `approvals`/reviewer-console routes are **not** part of this
 * consolidation and are untouched (`residency.routes.ts` keeps only its
 * bare `residency` entry).
 */
export const AGENT_BUILDER_LEGACY_REDIRECTS: Routes = [
  { path: 'tenants/:id/tools', pathMatch: 'full', redirectTo: 'tenants/:id/builder/tools' },
  { path: 'tenants/:id/reasoning', pathMatch: 'full', redirectTo: 'tenants/:id/builder/reasoning' },
  { path: 'tenants/:id/knowledge', pathMatch: 'full', redirectTo: 'tenants/:id/builder/knowledge' },
  { path: 'tenants/:id/skills', pathMatch: 'full', redirectTo: 'tenants/:id/builder/skills' },
  { path: 'tenants/:id/skills/:skillId', pathMatch: 'full', redirectTo: 'tenants/:id/builder/skills/:skillId' },
  { path: 'tenants/:id/hitl', pathMatch: 'full', redirectTo: 'tenants/:id/builder/hitl' },
  { path: 'tenants/:id/hitl/reviewer-groups', pathMatch: 'full', redirectTo: 'tenants/:id/builder/hitl/reviewer-groups' },
  { path: 'tenants/:id/residency', pathMatch: 'full', redirectTo: 'tenants/:id/builder/privacy' },
];
