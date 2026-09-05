import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ResidencyService } from './residency.service';
import { ResidencyApiService } from '@liveavatar/web-shared';

describe('ResidencyService', () => {
  it('delegates get/update to ResidencyApiService', () => {
    const api = { get: jest.fn().mockReturnValue(of({})), update: jest.fn().mockReturnValue(of({})) };
    TestBed.configureTestingModule({ providers: [{ provide: ResidencyApiService, useValue: api }] });
    const service = TestBed.inject(ResidencyService);

    service.get('t1').subscribe();
    expect(api.get).toHaveBeenCalledWith('t1');

    service.update('t1', { send_to_remote_llm: 'none', retain_transcripts_days: 30, recordings_enabled: false }, 'if-match').subscribe();
    expect(api.update).toHaveBeenCalledWith('t1', { send_to_remote_llm: 'none', retain_transcripts_days: 30, recordings_enabled: false }, 'if-match');
  });
});
