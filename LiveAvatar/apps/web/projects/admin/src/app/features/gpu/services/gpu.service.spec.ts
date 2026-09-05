import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { GpuService } from './gpu.service';
import { GpuApiService } from '@liveavatar/web-shared';

describe('GpuService', () => {
  it('delegates list to GpuApiService', () => {
    const api = { list: jest.fn().mockReturnValue(of({ items: [], total: 0 })) };
    TestBed.configureTestingModule({ providers: [{ provide: GpuApiService, useValue: api }] });
    const service = TestBed.inject(GpuService);
    service.list({ role: 'stt' }).subscribe();
    expect(api.list).toHaveBeenCalledWith({ role: 'stt' });
  });
});
