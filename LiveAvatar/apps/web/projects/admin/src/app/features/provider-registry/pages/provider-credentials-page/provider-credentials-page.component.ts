import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ProbeStatus, ProviderCredentialDto, ProviderDefinitionDto, TenantDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  PageHeaderComponent,
  ProviderBadgeComponent,
  TenantsApiService,
  formatRelativeTime,
  type AppClientError,
} from '@liveavatar/web-shared';
import { ProviderRegistryService } from '../../services/provider-registry.service';
import { CredentialDialogComponent } from '../../components/credential-dialog/credential-dialog.component';

/** Connection status → icon/label (§9.9 step 2). Never colour alone. */
const PROBE_STATUS_META: Record<ProbeStatus, { icon: string; label: string }> = {
  healthy: { icon: 'check_circle', label: 'Healthy' },
  degraded: { icon: 'warning', label: 'Degraded' },
  unreachable: { icon: 'error', label: 'Unreachable' },
  unknown: { icon: 'help_outline', label: 'Not tested' },
};

/**
 * Per-tenant provider credential list (Screen 4 bottom half, FR-PROVIDER-2/3,
 * UX_GUIDELINES §9.9–9.15).
 */
@Component({
  selector: 'la-provider-credentials-page',
  standalone: true,
  imports: [
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    ProviderBadgeComponent,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './provider-credentials-page.component.html',
  styleUrl: './provider-credentials-page.component.scss',
})
export class ProviderCredentialsPageComponent implements OnInit {
  private readonly registry = inject(ProviderRegistryService);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly definitions = signal<ProviderDefinitionDto[]>([]);
  readonly items = signal<ProviderCredentialDto[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<AppClientError | null>(null);
  readonly probingId = signal<string | null>(null);

  readonly displayedColumns = ['provider', 'label', 'endpoint', 'secret', 'connection', 'actions'];

  ngOnInit(): void {
    this.tenantsApi.get(this.tenantId).subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: (error: AppClientError) => {
        if (error.code === 'TENANT_NOT_FOUND') {
          this.snackBar.open('Tenant not found.', 'Dismiss', { duration: 6000 });
          void this.router.navigate(['/deployments']);
        }
      },
    });
    this.registry.listDefinitions().subscribe((response) => {
      this.definitions.set(response.items.filter((d) => d.enabled));
    });
    this.fetch();
  }

  retry(): void {
    this.fetch();
  }

  probeStatusMeta(status: ProbeStatus) {
    return PROBE_STATUS_META[status];
  }

  /** @param providerKey - Catalog key on a credential row */
  displayNameFor(providerKey: string): string {
    return this.definitions().find((d) => d.key === providerKey)?.display_name ?? providerKey;
  }

  /** @param providerKey - Catalog key on a credential row */
  hostingFor(providerKey: string): 'self_hosted' | 'remote' {
    return this.definitions().find((d) => d.key === providerKey)?.hosting ?? 'self_hosted';
  }

  relativeTime(iso: string | null): string {
    return iso ? formatRelativeTime(iso) : 'Never checked';
  }

  openAddDialog(): void {
    const ref = this.dialog.open(CredentialDialogComponent, {
      width: '520px',
      data: { tenantId: this.tenantId, definitions: this.definitions() },
    });
    ref.afterClosed().subscribe((credential) => {
      if (credential) {
        this.snackBar.open('Credential added.', 'Dismiss', { duration: 6000 });
        this.fetch();
      }
    });
  }

  openEditDialog(row: ProviderCredentialDto): void {
    const ref = this.dialog.open(CredentialDialogComponent, {
      width: '520px',
      data: { tenantId: this.tenantId, definitions: this.definitions(), existing: row },
    });
    ref.afterClosed().subscribe((credential) => {
      if (credential) {
        this.snackBar.open('Credential saved.', 'Dismiss', { duration: 6000 });
        this.fetch();
      }
    });
  }

  probe(row: ProviderCredentialDto): void {
    this.probingId.set(row.id);
    this.registry.probeCredential(this.tenantId, row.id).subscribe({
      next: (result) => {
        this.probingId.set(null);
        this.items.update((items) =>
          items.map((i) =>
            i.id === row.id
              ? { ...i, last_probe_status: result.status, last_probe_at: result.probed_at, last_probe_error: result.message ?? null }
              : i,
          ),
        );
      },
      error: (error: AppClientError) => {
        this.probingId.set(null);
        if (error.code === 'PROVIDER_PROBE_RATE_LIMITED') {
          this.snackBar.open('Too many connection tests. Try again in a minute.', 'Dismiss', { duration: 6000 });
          return;
        }
        this.snackBar.open('Could not test this connection. Try again.', 'Dismiss', { duration: 6000 });
      },
    });
  }

  deleteCredential(row: ProviderCredentialDto): void {
    const label = row.display_label && row.display_label !== 'default' ? row.display_label : row.provider_key;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this credential?',
        body: `${label} at ${row.endpoint_url} will no longer be available to Agent Builder.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.registry.deleteCredential(this.tenantId, row.id).subscribe({
        next: () => {
          this.snackBar.open('Credential deleted.', 'Dismiss', { duration: 6000 });
          this.fetch();
        },
        error: (error: AppClientError) => {
          if (error.code === 'CONFIG_CREDENTIAL_MISSING') {
            this.snackBar.open(
              "This credential is used by the published configuration for this deployment and can't be deleted. Change the provider in Agent Builder first, then delete this credential.",
              'Open Agent Builder',
              { duration: 10000 },
            );
            return;
          }
          this.snackBar.open('Could not delete this credential. Try again.', 'Dismiss', { duration: 6000 });
        },
      });
    });
  }

  private fetch(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.registry.listCredentials(this.tenantId).subscribe({
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
