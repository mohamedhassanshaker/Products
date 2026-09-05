import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ProviderHosting } from '@liveavatar/contracts';
import { HostingBadgeComponent } from '../hosting-badge/hosting-badge.component';

/**
 * Provider display name + hosting badge, the compound label used in every
 * catalog/credential/dropdown row (UX_GUIDELINES §9.9 "Provider" column,
 * §10.5 dropdown options).
 */
@Component({
  selector: 'la-provider-badge',
  standalone: true,
  imports: [HostingBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="la-provider-badge">
      <span class="la-provider-badge__name">{{ displayName() }}</span>
      <la-hosting-badge [hosting]="hosting()" />
    </span>
  `,
  styleUrl: './provider-badge.component.scss',
})
export class ProviderBadgeComponent {
  readonly displayName = input.required<string>();
  readonly hosting = input.required<ProviderHosting>();
}
