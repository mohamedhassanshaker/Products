import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import type { ProviderCategory, ProviderDefinitionDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  HostingBadgeComponent,
  PageHeaderComponent,
  type AppClientError,
} from '@liveavatar/web-shared';
import { AuthStore } from '../../../../core/auth/auth.store';
import { ProviderRegistryService } from '../../services/provider-registry.service';

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  transport: 'Transport',
  stt: 'Speech to text',
  llm: 'LLM',
  tts: 'Text to speech',
  avatar: 'Avatar',
};

const CATEGORY_ORDER: ProviderCategory[] = ['transport', 'stt', 'llm', 'tts', 'avatar'];

/**
 * Global provider catalog — Screen 4 top half (FR-PROVIDER-1, UX_GUIDELINES
 * §9.1–9.8). Read-only for `admin`; `operator` may enable/disable a row,
 * blocked from disabling the last enabled provider in a category.
 */
@Component({
  selector: 'la-provider-catalog-page',
  standalone: true,
  imports: [
    PageHeaderComponent,
    EmptyStateComponent,
    HostingBadgeComponent,
    MatIconModule,
    MatProgressBarModule,
    MatSlideToggleModule,
    MatTableModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-catalog-page.component.html',
  styleUrl: './provider-catalog-page.component.scss',
})
export class ProviderCatalogPageComponent implements OnInit {
  private readonly registry = inject(ProviderRegistryService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly authStore = inject(AuthStore);

  readonly loading = signal(true);
  readonly loadError = signal<AppClientError | null>(null);
  readonly items = signal<ProviderDefinitionDto[]>([]);
  readonly pendingKey = signal<string | null>(null);
  /** Inline `PROVIDER_CATEGORY_EMPTY` error, keyed by provider key (§9.2 step 6). */
  readonly rowErrors = signal<Record<string, string>>({});

  readonly categoryOrder = CATEGORY_ORDER;

  readonly groups = computed(() => {
    const byCategory = new Map<ProviderCategory, ProviderDefinitionDto[]>();
    for (const item of this.items()) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: byCategory.get(category) ?? [],
    }));
  });

  ngOnInit(): void {
    this.fetch();
  }

  retry(): void {
    this.fetch();
  }

  /** @param provider - Row whose toggle changed */
  onToggle(provider: ProviderDefinitionDto, event: MatSlideToggleChange): void {
    const target = event.checked;
    this.clearRowError(provider.key);

    if (!target) {
      const ref = this.dialog.open(ConfirmDialogComponent, {
        width: '420px',
        data: {
          title: `Disable ${provider.display_name}?`,
          body: `Tenants configured to use ${provider.display_name} will fail validation until they switch providers. This does not affect sessions already in progress.`,
          confirmLabel: 'Disable',
          destructive: true,
        },
      });
      ref.afterClosed().subscribe((confirmed) => {
        if (confirmed) {
          this.setEnabled(provider, false);
        } else {
          event.source.checked = true;
        }
      });
      return;
    }
    this.setEnabled(provider, true);
  }

  private setEnabled(provider: ProviderDefinitionDto, enabled: boolean): void {
    this.pendingKey.set(provider.key);
    this.registry.setDefinitionEnabled(provider.key, { enabled }).subscribe({
      next: (updated) => {
        this.pendingKey.set(null);
        this.items.update((items) => items.map((i) => (i.key === updated.key ? updated : i)));
        this.snackBar.open(`${provider.display_name} ${enabled ? 'enabled' : 'disabled'}.`, 'Dismiss', {
          duration: 6000,
        });
      },
      error: (error: AppClientError) => {
        this.pendingKey.set(null);
        if (error.code === 'PROVIDER_CATEGORY_EMPTY') {
          this.rowErrors.update((errors) => ({ ...errors, [provider.key]: error.message }));
          // Revert: re-fetch is the simplest correct source of truth for the toggle state.
          this.fetch();
          return;
        }
        this.snackBar.open('Could not update this provider. Refresh and try again.', 'Dismiss', { duration: 6000 });
      },
    });
  }

  private clearRowError(key: string): void {
    this.rowErrors.update((errors) => {
      if (!(key in errors)) {
        return errors;
      }
      const next = { ...errors };
      delete next[key];
      return next;
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.registry.listDefinitions().subscribe({
      next: (response) => {
        this.items.set(response.items);
        this.loading.set(false);
      },
      error: (error: AppClientError) => {
        this.loadError.set(error);
        this.loading.set(false);
      },
    });
  }
}
