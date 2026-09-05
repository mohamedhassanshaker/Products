import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PageHeaderComponent, TenantSelectComponent } from '@liveavatar/web-shared';

/**
 * Residency picker/index (`/admin/residency`, UX_GUIDELINES §17.1). Same
 * picker/real-screen split as Alerts (§16.1) — see that component's
 * docstring for the shared rationale. This picker itself is explicitly out
 * of Phase 16's consolidation scope (`docs/v2/AgentBuilder_...HITL.md`), but
 * its target moved: the tenant-scoped real screen is now the Privacy tab
 * inside the Agent Builder shell (`agent-builder.routes.ts`), not its own
 * `tenants/:id/residency` route (which still resolves, via
 * `AGENT_BUILDER_LEGACY_REDIRECTS`, but this internal navigation goes
 * straight to the new path per `docs/v2/UX_SCOPE.md`'s "update internal
 * routerLinks... rather than relying solely on the redirect").
 */
@Component({
  selector: 'la-residency-picker-page',
  standalone: true,
  imports: [PageHeaderComponent, TenantSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './residency-picker-page.component.html',
})
export class ResidencyPickerPageComponent {
  private readonly router = inject(Router);

  onTenantChange(tenantId: string | null): void {
    if (tenantId) {
      void this.router.navigate(['/tenants', tenantId, 'builder', 'privacy']);
    }
  }
}
