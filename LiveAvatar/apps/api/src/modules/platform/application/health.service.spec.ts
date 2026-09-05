import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns status ok', () => {
    expect(new HealthService().getHealth()).toEqual({ status: 'ok' });
  });
});
