import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DashboardService } from './dashboard.service';
import { DashboardApiService } from '@liveavatar/web-shared';

describe('DashboardService', () => {
  it('delegates summary/providerHealth to DashboardApiService', () => {
    const api = { summary: jest.fn().mockReturnValue(of({})), providerHealth: jest.fn().mockReturnValue(of({})) };
    TestBed.configureTestingModule({ providers: [{ provide: DashboardApiService, useValue: api }] });
    const service = TestBed.inject(DashboardService);

    service.summary({ range: '24h' }).subscribe();
    expect(api.summary).toHaveBeenCalledWith({ range: '24h' });

    service.providerHealth().subscribe();
    expect(api.providerHealth).toHaveBeenCalled();
  });
});
