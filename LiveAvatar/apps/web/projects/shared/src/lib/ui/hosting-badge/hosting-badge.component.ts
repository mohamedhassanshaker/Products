import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ProviderHosting } from '@liveavatar/contracts';

/**
 * Self-hosted vs remote badge (FR-PROVIDER-6). Icon + text, never colour
 * alone (UX_GUIDELINES §1.2/§9.2): `dns` "Self-hosted" / `cloud` "Remote".
 */
@Component({
  selector: 'la-hosting-badge',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="la-hosting-badge">
      <mat-icon aria-hidden="true" class="la-hosting-badge__icon">{{ icon() }}</mat-icon>
      <span class="la-hosting-badge__label">{{ label() }}</span>
    </span>
  `,
  styleUrl: './hosting-badge.component.scss',
})
export class HostingBadgeComponent {
  readonly hosting = input.required<ProviderHosting>();

  readonly icon = computed(() => (this.hosting() === 'remote' ? 'cloud' : 'dns'));
  readonly label = computed(() => (this.hosting() === 'remote' ? 'Remote' : 'Self-hosted'));
}
