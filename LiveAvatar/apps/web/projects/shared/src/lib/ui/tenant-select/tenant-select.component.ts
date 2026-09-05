import { ChangeDetectionStrategy, Component, EventEmitter, OnInit, Output, inject, input, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import type { TenantListItemDto } from '@liveavatar/contracts';
import { TenantsApiService } from '../../api/tenants-api.service';

/**
 * Typeahead tenant picker (UX_GUIDELINES §13.8 shared primitive) — a
 * typeahead combobox over `GET /tenants?q=`, reused verbatim on Dashboard
 * (§13), Sessions (§14), and GPU health (§15) rather than three separate
 * pickers. Role-scoping is already handled server-side (an `admin`'s
 * `GET /tenants` call only ever returns their assigned tenants), so this
 * component needs no role-awareness of its own.
 */
@Component({
  selector: 'la-tenant-select',
  standalone: true,
  imports: [ReactiveFormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field appearance="outline" class="la-tenant-select">
      <mat-label>{{ label() }}</mat-label>
      <input matInput type="text" [formControl]="searchControl" [matAutocomplete]="auto" />
      <mat-autocomplete #auto="matAutocomplete" [displayWith]="displayTenant" (optionSelected)="onSelected($event.option.value)">
        <mat-option [value]="null">All tenants</mat-option>
        @for (tenant of options(); track tenant.id) {
          <mat-option [value]="tenant">{{ tenant.name }}</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
})
export class TenantSelectComponent implements OnInit {
  private readonly tenantsApi = inject(TenantsApiService);

  readonly label = input('Tenant');

  /** Emits the selected tenant id, or `null` for "All tenants". */
  @Output() readonly tenantChange = new EventEmitter<string | null>();

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly options = signal<TenantListItemDto[]>([]);

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => this.tenantsApi.list({ q: q || undefined, page: 1, page_size: 25 })),
      )
      .subscribe((response) => this.options.set(response.items));
    // Seed the initial option list so the panel isn't empty before the user types.
    this.tenantsApi.list({ page: 1, page_size: 25 }).subscribe((response) => this.options.set(response.items));
  }

  protected displayTenant(tenant: TenantListItemDto | null): string {
    return tenant ? tenant.name : '';
  }

  protected onSelected(tenant: TenantListItemDto | null): void {
    this.tenantChange.emit(tenant ? tenant.id : null);
  }
}
