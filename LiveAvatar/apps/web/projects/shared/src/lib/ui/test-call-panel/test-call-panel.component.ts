import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { TestCallResponseDto } from '@liveavatar/contracts';
import { DeploymentConfigApiService } from '../../api/deployment-config-api.service';
import type { AppClientError } from '../../errors/error-envelope';
import { nodeTypeIcon } from '../../util/node-type-icon';

/**
 * Shared "Test call" harness UI (Phase 9, BL-037; relocated to
 * `projects/shared` in Phase 12b per `docs/v2/UX_SCOPE.md`'s original
 * "build it once in Phase 9" instruction — Phase 9 built it inside the
 * `reasoning` feature folder without actually moving it, which this
 * project's own `import/no-restricted-paths` feature-isolation zones
 * blocked every other feature, including Knowledge, from importing).
 * Deliberately generic over its caller — it only needs a tenant id and a
 * draft config, both passed in — so the Reasoning tab mounts it and
 * Skills/Knowledge's playground can mount the same component without this
 * component knowing anything about either. Calls
 * `POST /tenants/:id/config/test-call`, a NestJS-side **structural
 * simulation** of the graph, not a live model/vendor run — every node
 * result's `simulated` flag is surfaced verbatim rather than presented as if
 * a real model ran (see `TestCallResponseSchema`'s doc comment).
 */
@Component({
  selector: 'la-test-call-panel',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './test-call-panel.component.html',
  styleUrl: './test-call-panel.component.scss',
})
export class TestCallPanelComponent {
  private readonly configApi = inject(DeploymentConfigApiService);

  @Input({ required: true }) tenantId!: string;
  /** The whole draft `AgentConfig` (or a `PartialAgentConfig`) to run the test call against — same shape `POST /config/validate` takes. */
  @Input({ required: true }) config!: unknown;

  /** Fires on every completed run (success or failure) so a host like the Reasoning tab can badge its node cards. */
  @Output() readonly resultChange = new EventEmitter<TestCallResponseDto | null>();

  readonly utterance = signal('');
  readonly running = signal(false);
  readonly result = signal<TestCallResponseDto | null>(null);
  readonly error = signal<AppClientError | null>(null);

  readonly nodeIcon = nodeTypeIcon;

  runDisabled(): boolean {
    return this.running() || this.utterance().trim().length === 0;
  }

  run(): void {
    if (this.runDisabled()) {
      return;
    }
    this.running.set(true);
    this.error.set(null);
    this.configApi.testCall(this.tenantId, { config: this.config, utterance: this.utterance().trim() }).subscribe({
      next: (response) => {
        this.running.set(false);
        this.result.set(response);
        this.resultChange.emit(response);
      },
      error: (err: AppClientError) => {
        this.running.set(false);
        this.error.set(err);
        this.resultChange.emit(null);
      },
    });
  }

  /** Summary-only text for the `aria-live="polite"` region — never re-announces the full node list (§10.7 precedent). */
  resultSummary(): string {
    const r = this.result();
    if (!r) {
      return '';
    }
    const failed = r.nodes.filter((n) => n.status === 'failed').length;
    return `${r.nodes.length} node${r.nodes.length === 1 ? '' : 's'} executed${failed > 0 ? `, ${failed} failed` : ''}.`;
  }
}
