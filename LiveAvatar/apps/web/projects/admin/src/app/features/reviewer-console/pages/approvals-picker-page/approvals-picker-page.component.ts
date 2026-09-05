import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PageHeaderComponent, TenantSelectComponent } from '@liveavatar/web-shared';

/**
 * Approvals picker/index (`/admin/approvals`). The real, editable screen is
 * tenant-scoped (`/admin/tenants/:id/approvals`) — this page is only a
 * `tenant_select` funnel into it, same pattern as `AlertsPickerPageComponent`/
 * `ResidencyPickerPageComponent` (the sidebar nav-scaffold predates
 * tenant-scoped routes, §1.7's routing-conflict note).
 */
@Component({
  selector: 'la-approvals-picker-page',
  standalone: true,
  imports: [PageHeaderComponent, TenantSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approvals-picker-page.component.html',
})
export class ApprovalsPickerPageComponent {
  private readonly router = inject(Router);

  onTenantChange(tenantId: string | null): void {
    if (tenantId) {
      void this.router.navigate(['/tenants', tenantId, 'approvals']);
    }
  }
}
