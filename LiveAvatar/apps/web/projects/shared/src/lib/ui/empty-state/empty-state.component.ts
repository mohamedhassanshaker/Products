import { ChangeDetectionStrategy, Component, EventEmitter, Output, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** `success` = zero-data/coming-soon (not an error); `error` = load failure with Retry semantics. */
export type EmptyStateVariant = 'success' | 'error';

/**
 * Zero-data / load-failure surface (LLD §3.2 shared primitive). Used for the
 * Deployments empty states, the shared "coming soon" page, and any future
 * list's empty/error state (UX_GUIDELINES §5.2, §7).
 */
@Component({
  selector: 'la-empty-state',
  standalone: true,
  imports: [MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="la-empty-state" [attr.role]="variant() === 'error' ? 'alert' : null">
      <mat-icon aria-hidden="true" class="la-empty-state__icon">{{ icon() }}</mat-icon>
      <h2 class="la-empty-state__title" tabindex="-1">{{ title() }}</h2>
      <p class="la-empty-state__body">{{ body() }}</p>
      @if (actionLabel()) {
        <button mat-flat-button color="primary" type="button" (click)="action.emit()">
          {{ actionLabel() }}
        </button>
      }
    </div>
  `,
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly variant = input<EmptyStateVariant>('success');
  readonly icon = input<string>('inbox');
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly actionLabel = input<string>();

  @Output() readonly action = new EventEmitter<void>();
}
