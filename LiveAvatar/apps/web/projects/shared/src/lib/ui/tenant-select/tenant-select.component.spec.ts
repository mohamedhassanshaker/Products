import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { TenantSelectComponent } from './tenant-select.component';
import { TenantsApiService } from '../../api/tenants-api.service';

describe('TenantSelectComponent', () => {
  let fixture: ComponentFixture<TenantSelectComponent>;
  let tenantsApi: { list: jest.Mock };

  function setup() {
    tenantsApi = { list: jest.fn().mockReturnValue(of({ items: [{ id: 't1', name: 'Acme', slug: 'acme' }], total: 1, page: 1, page_size: 25 })) };
    TestBed.configureTestingModule({
      imports: [TenantSelectComponent],
      providers: [{ provide: TenantsApiService, useValue: tenantsApi }],
    });
    fixture = TestBed.createComponent(TenantSelectComponent);
    fixture.detectChanges();
  }

  it('seeds the option list on init', () => {
    setup();
    expect(tenantsApi.list).toHaveBeenCalledWith({ page: 1, page_size: 25 });
    expect(fixture.componentInstance['options']()).toHaveLength(1);
  });

  it('emits null for the "All tenants" option', () => {
    setup();
    const emitted: (string | null)[] = [];
    fixture.componentInstance.tenantChange.subscribe((v) => emitted.push(v));
    fixture.componentInstance['onSelected'](null);
    expect(emitted).toEqual([null]);
  });

  it('emits the tenant id when a tenant is selected', () => {
    setup();
    const emitted: (string | null)[] = [];
    fixture.componentInstance.tenantChange.subscribe((v) => emitted.push(v));
    fixture.componentInstance['onSelected']({ id: 't1', name: 'Acme', slug: 'acme' } as never);
    expect(emitted).toEqual(['t1']);
  });

  it('re-queries with the typed search term after the debounce window', fakeAsync(() => {
    setup();
    tenantsApi.list.mockClear();
    fixture.componentInstance['searchControl'].setValue('ac');
    tick(300);
    expect(tenantsApi.list).toHaveBeenCalledWith({ q: 'ac', page: 1, page_size: 25 });
  }));

  it('displayTenant renders the tenant name or empty string', () => {
    setup();
    expect(fixture.componentInstance['displayTenant']({ name: 'Acme' } as never)).toBe('Acme');
    expect(fixture.componentInstance['displayTenant'](null)).toBe('');
  });
});
