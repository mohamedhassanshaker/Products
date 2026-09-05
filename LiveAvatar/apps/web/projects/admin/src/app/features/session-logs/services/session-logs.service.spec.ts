import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SessionLogsService } from './session-logs.service';
import { SessionLogsApiService } from '@liveavatar/web-shared';

describe('SessionLogsService', () => {
  it('delegates every method to SessionLogsApiService', () => {
    const api = {
      list: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, page_size: 25 })),
      detail: jest.fn().mockReturnValue(of({})),
      transcript: jest.fn().mockReturnValue(of({ items: [] })),
      hops: jest.fn().mockReturnValue(of({ cycles: [] })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SessionLogsApiService, useValue: api }] });
    const service = TestBed.inject(SessionLogsService);

    service.list({}).subscribe();
    expect(api.list).toHaveBeenCalledWith({});

    service.detail('s1').subscribe();
    expect(api.detail).toHaveBeenCalledWith('s1');

    service.transcript('s1').subscribe();
    expect(api.transcript).toHaveBeenCalledWith('s1');

    service.hops('s1').subscribe();
    expect(api.hops).toHaveBeenCalledWith('s1');
  });
});
