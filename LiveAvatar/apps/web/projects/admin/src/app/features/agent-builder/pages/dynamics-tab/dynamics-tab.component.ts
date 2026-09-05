import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { BargeIn, CallLimits, NoInput, Verbosity } from '@liveavatar/contracts';
import { EmptyStateComponent } from '@liveavatar/web-shared';
import { AgentBuilderStore } from '../../store/agent-builder.store';

const SENSITIVITIES: BargeIn['sensitivity'][] = ['low', 'medium', 'high'];
const VERBOSITIES: Verbosity[] = ['concise', 'balanced', 'detailed'];

/**
 * Dynamics tab (Phase 16, BL-062 — `docs/v2/UX_SCOPE.md` "Dynamics: plain
 * new form... follows the same field-pattern as the Tools attach form",
 * `packages/contracts/src/agent-config/dynamics.schema.ts`, already built
 * and frozen this phase). Barge-in, endpointing, verbosity, no-input, and
 * call-limit fields — a genuinely new, net-new-fields surface with **no
 * runtime behavior behind it yet** (confirmed in the schema file's own doc
 * comment: no wiring exists anywhere in `apps/agent`). This tab is honestly
 * just config storage for now; nothing here claims otherwise.
 *
 * `dynamics` is optional on the wire — `AgentBuilderStore.dynamics()`
 * already resolves to the schema's own defaults when the tenant's config
 * has never had this block set, so every control below always has a value
 * to show. The first edit on this tab writes a *fully-populated* `dynamics`
 * object back (defaults merged with the one changed field), not a sparse
 * partial — the simplest of the reasonable options and consistent with how
 * every other setter in this store already works (e.g. `onSttProvider`
 * writes a whole new `{ ...current, provider, credential_ref }` object,
 * never a bare `{ provider }`).
 *
 * Shares `AgentBuilderStore` with the Pipeline tab (both edit slices of the
 * same whole-config document) and, like it, does not call `store.load()`
 * itself — see `PipelineTabComponent`'s doc comment for why.
 */
@Component({
  selector: 'la-dynamics-tab',
  standalone: true,
  imports: [
    FormsModule,
    EmptyStateComponent,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dynamics-tab.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', '../builder-shared.scss'],
})
export class DynamicsTabComponent {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(AgentBuilderStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly sensitivities = SENSITIVITIES;
  readonly verbosities = VERBOSITIES;

  /** Errors for a Gate A structural check against this exact field path (e.g. `/dynamics/endpointing_silence_ms`) — see `AgentBuilderStore.errorsByField`'s doc comment. */
  errorsFor(fieldPath: string): string[] {
    return (this.store.errorsByField().get(fieldPath) ?? []).map((e) => e.message);
  }

  onBargeInEnabled(enabled: boolean): void {
    this.patchBargeIn({ enabled });
  }

  onBargeInSensitivity(sensitivity: BargeIn['sensitivity']): void {
    this.patchBargeIn({ sensitivity });
  }

  onEndpointingSilenceMs(endpointing_silence_ms: number): void {
    this.store.patchDraft({ dynamics: { ...this.store.dynamics(), endpointing_silence_ms } });
  }

  onVerbosity(verbosity: Verbosity): void {
    this.store.patchDraft({ dynamics: { ...this.store.dynamics(), verbosity } });
  }

  onNoInputTimeoutMs(timeout_ms: number): void {
    this.patchNoInput({ timeout_ms });
  }

  onNoInputMaxReprompts(max_reprompts: number): void {
    this.patchNoInput({ max_reprompts });
  }

  onMaxTurnTokens(max_turn_tokens: number): void {
    this.patchCallLimits({ max_turn_tokens });
  }

  onMaxTurnSeconds(max_turn_seconds: number): void {
    this.patchCallLimits({ max_turn_seconds });
  }

  private patchBargeIn(patch: Partial<BargeIn>): void {
    const current = this.store.dynamics();
    this.store.patchDraft({ dynamics: { ...current, barge_in: { ...current.barge_in, ...patch } } });
  }

  private patchNoInput(patch: Partial<NoInput>): void {
    const current = this.store.dynamics();
    this.store.patchDraft({ dynamics: { ...current, no_input: { ...current.no_input, ...patch } } });
  }

  private patchCallLimits(patch: Partial<CallLimits>): void {
    const current = this.store.dynamics();
    this.store.patchDraft({ dynamics: { ...current, call_limits: { ...current.call_limits, ...patch } } });
  }
}
