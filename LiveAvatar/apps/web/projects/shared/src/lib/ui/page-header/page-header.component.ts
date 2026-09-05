import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Page title + primary actions slot (LLD §3.2 shared primitive). One `h1`
 * per page (WCAG 2.2 AA structure requirement, UX_GUIDELINES §1.2).
 */
@Component({
  selector: 'la-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="la-page-header">
      <div class="la-page-header__text">
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="la-page-header__subtitle">{{ subtitle() }}</p>
        }
      </div>
      <div class="la-page-header__actions">
        <ng-content />
      </div>
    </header>
  `,
  styleUrl: './page-header.component.scss',
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
