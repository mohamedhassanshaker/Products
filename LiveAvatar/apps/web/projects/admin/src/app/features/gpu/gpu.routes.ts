import type { Routes } from '@angular/router';

/** GPU health feature routes (Screen 6, UX_GUIDELINES §15). */
export const GPU_ROUTES: Routes = [
  {
    path: 'gpu',
    loadComponent: () => import('./pages/gpu-page/gpu-page.component').then((m) => m.GpuPageComponent),
    title: 'GPU health · Avatar Platform',
  },
];
