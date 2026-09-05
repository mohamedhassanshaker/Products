import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Wildcard fallback for any URL that doesn't match `/:slug`, `/:slug/call`,
 * or `/:slug/summary/:sessionId/:summaryToken` (`app.routes.ts`) — most
 * commonly the bare app root with no tenant slug at all. This SPA has no
 * nav and no route for "no tenant" by design (`app.routes.ts`'s own
 * docstring), so without this, that URL shape rendered a fully blank page
 * with zero feedback — confusing enough in practice (reported against the
 * bare `/c/` root) to warrant this minimal explanatory dead-end, reusing
 * the same `la-precall--dead-end` visual language as the
 * browser-unsupported page.
 */
@Component({
  selector: 'la-conv-no-tenant-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './no-tenant-page.component.html',
  styleUrl: './no-tenant-page.component.scss',
})
export class NoTenantPageComponent {}
