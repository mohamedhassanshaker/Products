import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Visual tone → CSS class. Status is never colour alone (UX_GUIDELINES §1.2): icon + text always. */
export type StatusChipTone = 'success' | 'caution' | 'neutral' | 'error';

/**
 * Icon + text status indicator (LLD §3.2 shared primitive). Used for tenant
 * `active`/`paused` chips on the Deployments list, and reusable for any
 * future status surface.
 */
@Component({
  selector: 'la-status-chip',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="la-status-chip la-status-chip--{{ tone() }}">
      <mat-icon aria-hidden="true" class="la-status-chip__icon">{{ icon() }}</mat-icon>
      <span class="la-status-chip__label">{{ label() }}</span>
    </span>
  `,
  styleUrl: './status-chip.component.scss',
})
export class StatusChipComponent {
  readonly tone = input.required<StatusChipTone>();
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
}
