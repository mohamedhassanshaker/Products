import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PageHeaderComponent, TenantSelectComponent } from '@liveavatar/web-shared';

/**
 * Alerts picker/index (`/admin/alerts`, UX_GUIDELINES §16.1). The real,
 * editable screen is tenant-scoped (`/admin/tenants/:id/alerts`) — this page
 * is only a `tenant_select` funnel into it, since the sidebar nav-scaffold
 * predates this tenant-scoped API shape (§1.7's routing-conflict note).
 */
@Component({
  selector: 'la-alerts-picker-page',
  standalone: true,
  imports: [PageHeaderComponent, TenantSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alerts-picker-page.component.html',
})
export class AlertsPickerPageComponent {
  private readonly router = inject(Router);

  onTenantChange(tenantId: string | null): void {
    if (tenantId) {
      void this.router.navigate(['/tenants', tenantId, 'alerts']);
    }
  }
}
