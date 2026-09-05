import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AlertsService } from './alerts.service';
import { AlertsApiService } from '@liveavatar/web-shared';

describe('AlertsService', () => {
  it('delegates every method to AlertsApiService', () => {
    const api = {
      getPolicy: jest.fn().mockReturnValue(of({})),
      updatePolicy: jest.fn().mockReturnValue(of({})),
      listAlerts: jest.fn().mockReturnValue(of({ items: [], total: 0 })),
      failoverStats: jest.fn().mockReturnValue(of({})),
    };
    TestBed.configureTestingModule({ providers: [{ provide: AlertsApiService, useValue: api }] });
    const service = TestBed.inject(AlertsService);

    service.getPolicy('t1').subscribe();
    expect(api.getPolicy).toHaveBeenCalledWith('t1');

    service.updatePolicy('t1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, 'if-match').subscribe();
    expect(api.updatePolicy).toHaveBeenCalledWith('t1', { retry_max_attempts: 3, retry_backoff_ms: [1, 2, 3], degraded_mode_message: 'm' }, 'if-match');

    service.listAlerts('t1').subscribe();
    expect(api.listAlerts).toHaveBeenCalledWith('t1', {});

    service.failoverStats('t1').subscribe();
    expect(api.failoverStats).toHaveBeenCalledWith('t1', {});
  });
});
