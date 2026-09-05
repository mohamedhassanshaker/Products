import { Routes } from '@angular/router';

/** Provider Registry feature routes (Screen 4, UX_GUIDELINES §9). */
export const PROVIDER_REGISTRY_ROUTES: Routes = [
  {
    path: 'providers',
    loadComponent: () =>
      import('./pages/provider-catalog-page/provider-catalog-page.component').then(
        (m) => m.ProviderCatalogPageComponent,
      ),
    title: 'Providers · Avatar Platform',
  },
  {
    path: 'tenants/:id/provider-credentials',
    loadComponent: () =>
      import('./pages/provider-credentials-page/provider-credentials-page.component').then(
        (m) => m.ProviderCredentialsPageComponent,
      ),
    title: 'Provider credentials · Avatar Platform',
  },
];
