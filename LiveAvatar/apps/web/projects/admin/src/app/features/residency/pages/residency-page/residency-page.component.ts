import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ResidencyResponse } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { ResidencyService } from '../../services/residency.service';

type SendToRemoteLlm = 'prompt_text_only' | 'prompt_and_transcript' | 'none';

/**
 * Data residency / privacy settings — Screen 8 real screen
 * (`/admin/tenants/:id/residency`, FR-PRIV-1/2, UX_GUIDELINES §17.2). This is
 * the operator control surface + publish gate for the residency policy the
 * agent already enforces at runtime (`residency/filter.py`, Phase 4) — no
 * enforcement logic lives here.
 */
@Component({
  selector: 'la-residency-page',
  standalone: true,
  imports: [PageHeaderComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './residency-page.component.html',
  styleUrl: './residency-page.component.scss',
})
export class ResidencyPageComponent implements OnInit {
  private readonly residency = inject(ResidencyService);
  private readonly tenants = inject(TenantsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  private readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';

  readonly tenantName = signal('');
  readonly tenantNotFound = signal(false);
  readonly loading = signal(true);

  private updatedAt = '';
  readonly sendToRemoteLlm = signal<SendToRemoteLlm>('prompt_text_only');
  readonly retainTranscriptsDays = signal(90);
  readonly recordingsEnabled = signal(false);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saved = signal(false);

  ngOnInit(): void {
    this.tenants.get(this.tenantId).subscribe({
      next: (tenant) => this.tenantName.set(tenant.name),
      error: () => {
        this.tenantNotFound.set(true);
        this.snackBar.open('Tenant not found.', 'Dismiss', { duration: 6000 });
      },
    });
    this.fetch();
  }

  onModeChange(mode: SendToRemoteLlm): void {
    this.sendToRemoteLlm.set(mode);
  }

  onRetentionChange(days: number): void {
    this.retainTranscriptsDays.set(days);
  }

  onRecordingsToggle(enabled: boolean): void {
    this.recordingsEnabled.set(enabled);
  }

  save(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.residency
      .update(
        this.tenantId,
        {
          send_to_remote_llm: this.sendToRemoteLlm(),
          retain_transcripts_days: this.retainTranscriptsDays(),
          recordings_enabled: this.recordingsEnabled(),
        },
        this.updatedAt,
      )
      .subscribe({
        next: (result) => {
          this.updatedAt = result.updated_at;
          this.saving.set(false);
          this.saved.set(true);
          this.snackBar.open('Residency settings saved.', 'Dismiss', { duration: 6000 });
        },
        error: (error: { message: string }) => {
          this.saving.set(false);
          this.saveError.set(error.message);
        },
      });
  }

  backToDeployments(): void {
    void this.router.navigate(['/deployments']);
  }

  private fetch(): void {
    this.loading.set(true);
    this.residency.get(this.tenantId).subscribe({
      next: (result: ResidencyResponse) => {
        this.sendToRemoteLlm.set(result.send_to_remote_llm);
        this.retainTranscriptsDays.set(result.retain_transcripts_days);
        this.recordingsEnabled.set(result.recordings_enabled);
        this.updatedAt = result.updated_at;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
