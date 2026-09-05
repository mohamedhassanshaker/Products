import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import type { HopCycle, TranscriptResponse } from '@liveavatar/web-shared';
import type { SessionDetailDto } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, StatusChipComponent, nodeTypeIcon, nodeTypeLabel, type AppClientError } from '@liveavatar/web-shared';
import { SessionLogsService } from '../../services/session-logs.service';

/** Session logs — Screen 5 detail (FR-SESS-2/3, UX_GUIDELINES §14.2). */
@Component({
  selector: 'la-session-detail-page',
  standalone: true,
  imports: [PageHeaderComponent, EmptyStateComponent, StatusChipComponent, MatIconModule, MatProgressBarModule, MatTableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-detail-page.component.html',
  styleUrl: './session-detail-page.component.scss',
})
export class SessionDetailPageComponent implements OnInit {
  private readonly sessions = inject(SessionLogsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly hopColumns = ['utterance_seq', 'stt', 'llm', 'tts', 'avatar', 'e2e'];

  readonly session = signal<SessionDetailDto | null>(null);
  readonly sessionLoading = signal(true);
  readonly sessionError = signal<AppClientError | null>(null);

  readonly transcript = signal<TranscriptResponse | null>(null);
  readonly transcriptLoading = signal(true);
  readonly transcriptError = signal<AppClientError | null>(null);
  readonly transcriptPurged = signal(false);

  readonly hopCycles = signal<HopCycle[]>([]);
  readonly hopsLoading = signal(true);
  readonly hopsError = signal<AppClientError | null>(null);

  /** Icon/label helpers — same node-type vocabulary the Reasoning tab uses (`UX_SCOPE.md` "recognition over recall"). */
  readonly nodeIcon = nodeTypeIcon;
  readonly nodeLabel = nodeTypeLabel;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.fetchSession(id);
    this.fetchTranscript(id);
    this.fetchHops(id);
  }

  backToSessions(): void {
    void this.router.navigate(['/sessions']);
  }

  hopCell(cycle: HopCycle, hop: 'stt' | 'llm' | 'tts' | 'avatar' | 'e2e'): string {
    const timing = cycle[hop];
    if (!timing || timing.total_ms === undefined) {
      return '—';
    }
    return `${timing.total_ms}ms`;
  }

  /** Cycles that actually executed graph nodes (Phase 9, BL-039) — most sessions predate the graph interpreter and have none. */
  cyclesWithNodes(): HopCycle[] {
    return this.hopCycles().filter((c) => (c.nodes?.length ?? 0) > 0);
  }

  /** Summary-only text for the node trace's `aria-live="polite"` region — never re-announces the full per-node table (§10.7 precedent). */
  nodeTraceSummary(): string {
    const total = this.hopCycles().reduce((sum, c) => sum + (c.nodes?.length ?? 0), 0);
    const cycles = this.cyclesWithNodes().length;
    return `${total} node execution${total === 1 ? '' : 's'} across ${cycles} cycle${cycles === 1 ? '' : 's'}.`;
  }

  private fetchSession(id: string): void {
    this.sessionLoading.set(true);
    this.sessions.detail(id).subscribe({
      next: (result) => {
        this.session.set(result);
        this.sessionLoading.set(false);
      },
      error: (error: AppClientError) => {
        this.sessionError.set(error);
        this.sessionLoading.set(false);
      },
    });
  }

  private fetchTranscript(id: string): void {
    this.transcriptLoading.set(true);
    this.sessions.transcript(id).subscribe({
      next: (result) => {
        this.transcript.set(result);
        this.transcriptLoading.set(false);
      },
      error: (error: AppClientError) => {
        if (error.status === 410) {
          this.transcriptPurged.set(true);
        } else {
          this.transcriptError.set(error);
        }
        this.transcriptLoading.set(false);
      },
    });
  }

  private fetchHops(id: string): void {
    this.hopsLoading.set(true);
    this.sessions.hops(id).subscribe({
      next: (result) => {
        this.hopCycles.set(result.cycles);
        this.hopsLoading.set(false);
      },
      error: (error: AppClientError) => {
        this.hopsError.set(error);
        this.hopsLoading.set(false);
      },
    });
  }
}
