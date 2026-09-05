import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AlertsPickerPageComponent } from './alerts-picker-page.component';
import { TenantsApiService } from '@liveavatar/web-shared';

describe('AlertsPickerPageComponent (UX_GUIDELINES §16.1)', () => {
  it('navigates to the tenant-scoped real screen once a tenant is chosen', () => {
    const router = { navigate: jest.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      imports: [AlertsPickerPageComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: TenantsApiService, useValue: { list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })) } },
      ],
    });
    const fixture: ComponentFixture<AlertsPickerPageComponent> = TestBed.createComponent(AlertsPickerPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.onTenantChange('t1');
    expect(router.navigate).toHaveBeenCalledWith(['/tenants', 't1', 'alerts']);
  });

  it('does nothing for the "All tenants" (null) selection', () => {
    const router = { navigate: jest.fn() };
    TestBed.configureTestingModule({
      imports: [AlertsPickerPageComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: TenantsApiService, useValue: { list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })) } },
      ],
    });
    const fixture: ComponentFixture<AlertsPickerPageComponent> = TestBed.createComponent(AlertsPickerPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.onTenantChange(null);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
