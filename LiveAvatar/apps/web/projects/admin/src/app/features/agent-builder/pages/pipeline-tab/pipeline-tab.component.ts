import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ProviderCategory, ProviderCredentialDto } from '@liveavatar/contracts';
import { EmptyStateComponent } from '@liveavatar/web-shared';
import { AgentBuilderStore } from '../../store/agent-builder.store';
import type { AgentConfigDraft } from '../../store/agent-config-draft.model';

/**
 * Pipeline tab (Phase 16, BL-065 — `docs/v2/UX_SCOPE.md` "Builder
 * consolidation"). Transport/STT/TTS/Avatar sections extracted verbatim
 * (same fields, same validation-error display, same credential-dropdown
 * conditional logic, same feature-gap tooltip) from the old
 * `agent-builder-page` this phase decommissions — `agent.system_prompt`/
 * `runtime`/`memory` moved to the Reasoning tab's new "Core instructions"
 * section instead (see `reasoning.store.ts`'s doc comment), and the
 * rollup links (residency/tools/reasoning/knowledge summaries) moved to the
 * new Overview tab, so this component owns only what a "Pipeline" concern
 * genuinely is (A9.1: "Transport, STT, TTS, avatar chains").
 *
 * Reads/writes the same shared `AgentBuilderStore` the Dynamics tab does —
 * both edit slices of the one whole-config document neither owns
 * exclusively. Deliberately does **not** call `store.load()` itself: the
 * parent `BuilderShellComponent` (the one component that survives every tab
 * switch, since Pipeline/Dynamics are child routes that remount on each
 * visit) loads it once on shell mount. If this component also called
 * `load()`, switching Dynamics → Pipeline → Dynamics would re-fetch and
 * silently discard any unsaved Dynamics edit, since both tabs share one
 * store instance. (The tenant-missing redirect guard lives once, in
 * `BuilderShellComponent`, rather than repeated in every tab.)
 */
@Component({
  selector: 'la-pipeline-tab',
  standalone: true,
  imports: [
    FormsModule,
    EmptyStateComponent,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pipeline-tab.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', '../builder-shared.scss'],
})
export class PipelineTabComponent {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(AgentBuilderStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';

  /** @param category - Catalog category to filter definitions by */
  definitionsFor(category: ProviderCategory) {
    return this.store.definitions().filter((d) => d.category === category);
  }

  /** @param providerKey - Candidate provider key */
  hasCredential(providerKey: string): boolean {
    return this.store.credentials().some((c) => c.provider_key === providerKey);
  }

  /** @param providerKey - Candidate provider key */
  requiresCredential(providerKey: string): boolean {
    return this.store.definitions().find((d) => d.key === providerKey)?.requires_credential ?? true;
  }

  /** @param providerKey - Candidate provider key — used to disable an uncredentialed option */
  optionDisabled(providerKey: string): boolean {
    return this.requiresCredential(providerKey) && !this.hasCredential(providerKey);
  }

  /**
   * All tenant credentials configured for a given provider key, used both to
   * auto-resolve `credential_ref` for the single-credential case and to
   * populate the secondary "Credential" dropdown when a provider has more
   * than one (UX_GUIDELINES §10.5).
   * @param providerKey - Candidate provider key
   */
  credentialsFor(providerKey: string | undefined): ProviderCredentialDto[] {
    if (!providerKey) {
      return [];
    }
    return this.store.credentials().filter((c) => c.provider_key === providerKey);
  }

  /** @param providerKey - Candidate provider key — true when the layer dropdown needs the secondary credential picker */
  hasMultipleCredentials(providerKey: string | undefined): boolean {
    return this.credentialsFor(providerKey).length > 1;
  }

  /**
   * Documented vendor capability gap for a catalog provider, if any
   * (FR-AVATAR-2 — e.g. Alibaba LiveAvatar's idle-motion/custom-upload gap
   * vs bitHuman). Verbatim spec/catalog copy, not paraphrased.
   * @param providerKey - Candidate provider key (any layer, not avatar-only)
   */
  featureGapsFor(providerKey: string | undefined): string | null {
    if (!providerKey) {
      return null;
    }
    return this.store.definitions().find((d) => d.key === providerKey)?.feature_gaps ?? null;
  }

  /**
   * Resolves the `credential_ref` to write when a provider is (re)selected
   * (UX_GUIDELINES §10.5).
   * @param providerKey - Newly selected provider key
   */
  private autoCredentialRef(providerKey: string | undefined): string | undefined {
    const creds = this.credentialsFor(providerKey);
    return creds.length === 1 ? (creds[0].credential_ref ?? undefined) : undefined;
  }

  errorsFor(layer: string): string[] {
    return (this.store.errorsByLayer().get(layer) ?? []).map((e) => e.message);
  }

  onSttProvider(provider: string): void {
    this.store.patchDraft({
      stt: { ...this.store.draft().stt, provider, credential_ref: this.autoCredentialRef(provider) },
    });
  }

  /** Explicit credential pick from the secondary dropdown (multi-credential case, §10.5). */
  onSttCredential(credential_ref: string): void {
    this.store.patchDraft({ stt: { ...this.store.draft().stt, credential_ref } });
  }

  onSttField(patch: Partial<NonNullable<AgentConfigDraft['stt']>>): void {
    this.store.patchDraft({ stt: { ...this.store.draft().stt, ...patch } });
  }

  onTtsProvider(provider: string): void {
    this.store.patchDraft({
      tts: { ...this.store.draft().tts, provider, credential_ref: this.autoCredentialRef(provider) },
    });
  }

  /** Explicit credential pick from the secondary dropdown (multi-credential case, §10.5). */
  onTtsCredential(credential_ref: string): void {
    this.store.patchDraft({ tts: { ...this.store.draft().tts, credential_ref } });
  }

  onTtsVoiceId(voice_id: string): void {
    this.store.patchDraft({ tts: { ...this.store.draft().tts, voice_id } });
  }

  onAvatarProvider(provider: string): void {
    this.store.patchDraft({
      avatar: { ...this.store.draft().avatar, provider, credential_ref: this.autoCredentialRef(provider) },
    });
  }

  /** Explicit credential pick from the secondary dropdown (multi-credential case, §10.5). */
  onAvatarCredential(credential_ref: string): void {
    this.store.patchDraft({ avatar: { ...this.store.draft().avatar, credential_ref } });
  }

  onAvatarId(avatar_id: string): void {
    this.store.patchDraft({ avatar: { ...this.store.draft().avatar, avatar_id } });
  }
}
