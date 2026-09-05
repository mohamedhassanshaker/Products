import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Read-only redacted YAML dump (Agent Builder preview pane, FR-CONFIG-4).
 * A plain `<pre>` with its own `aria-label` rather than a live region — the
 * whole document must not be re-announced on every debounce tick
 * (UX_GUIDELINES §10.7).
 */
@Component({
  selector: 'la-yaml-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pre class="la-yaml-viewer" aria-label="Redacted configuration YAML">{{ yaml() }}</pre>`,
  styleUrl: './yaml-viewer.component.scss',
})
export class YamlViewerComponent {
  readonly yaml = input.required<string>();
}
