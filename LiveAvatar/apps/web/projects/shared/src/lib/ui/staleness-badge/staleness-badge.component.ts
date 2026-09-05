import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Knowledge-source staleness badge (Phase 12a, `docs/plans/agent-builder-v2-plan.md`
 * "Frontend" deliverables). Renders nothing when the source is not stale — a
 * table row with a fresh index should not show an empty badge slot. Icon +
 * text, never colour alone (UX_GUIDELINES §1.2/§9.2), same convention as
 * {@link HostingBadgeComponent}.
 */
@Component({
  selector: 'la-staleness-badge',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isStale()) {
      <span class="la-staleness-badge">
        <mat-icon aria-hidden="true" class="la-staleness-badge__icon">warning</mat-icon>
        <span class="la-staleness-badge__label">Stale — source changed since last index</span>
      </span>
    }
  `,
  styleUrl: './staleness-badge.component.scss',
})
export class StalenessBadgeComponent {
  readonly isStale = input.required<boolean>();
}
