import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import type { GpuNodeDto } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, StatusChipComponent, TenantSelectComponent, formatRelativeTime, type AppClientError } from '@liveavatar/web-shared';
import { GpuService } from '../../services/gpu.service';

type RoleFilter = 'all' | 'stt' | 'tts' | 'avatar';

/**
 * GPU / node health monitor — Screen 6 (FR-GPU-1/2/3, UX_GUIDELINES §15).
 * Strictly read-only — no scale action of any kind exists on this screen.
 */
@Component({
  selector: 'la-gpu-page',
  standalone: true,
  imports: [ReactiveFormsModule, PageHeaderComponent, EmptyStateComponent, StatusChipComponent, TenantSelectComponent, MatIconModule, MatProgressBarModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gpu-page.component.html',
  styleUrl: './gpu-page.component.scss',
})
export class GpuPageComponent implements OnInit {
  private readonly gpu = inject(GpuService);

  readonly roleControl = new FormControl<RoleFilter>('all', { nonNullable: true });
  readonly tenantId = signal<string | null>(null);

  readonly items = signal<GpuNodeDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly loadError = signal<AppClientError | null>(null);

  hasActiveFilters(): boolean {
    return this.roleControl.value !== 'all' || Boolean(this.tenantId());
  }

  ngOnInit(): void {
    this.roleControl.valueChanges.subscribe(() => this.fetch());
    this.fetch();
  }

  onTenantChange(tenantId: string | null): void {
    this.tenantId.set(tenantId);
    this.fetch();
  }

  clearFilters(): void {
    this.roleControl.setValue('all', { emitEvent: false });
    this.tenantId.set(null);
    this.fetch();
  }

  retry(): void {
    this.fetch();
  }

  relativeTime(iso: string): string {
    return formatRelativeTime(iso);
  }

  roleIcon(role: string): string {
    switch (role) {
      case 'stt':
        return 'mic';
      case 'tts':
        return 'record_voice_over';
      default:
        return 'face';
    }
  }

  /**
   * QA fix (phase7-admin-spa D-2): UX_GUIDELINES §15.2 requires the role
   * rendered as icon + spec display text (STT/TTS/Avatar) — the template
   * previously bound `label` straight to `node.role` (the raw lowercase
   * enum value), unlike `roleIcon` which already had its own mapping.
   */
  roleLabel(role: string): string {
    switch (role) {
      case 'stt':
        return 'STT';
      case 'tts':
        return 'TTS';
      default:
        return 'Avatar';
    }
  }

  private fetch(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const role = this.roleControl.value === 'all' ? undefined : this.roleControl.value;
    this.gpu.list({ role, tenant_id: this.tenantId() ?? undefined }).subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.total.set(response.total);
        this.loading.set(false);
      },
      error: (error: AppClientError) => {
        this.loadError.set(error);
        this.loading.set(false);
      },
    });
  }
}
