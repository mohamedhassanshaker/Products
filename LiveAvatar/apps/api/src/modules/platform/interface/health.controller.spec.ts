import { HealthController } from './health.controller';
import { HealthService } from '../application/health.service';

describe('HealthController', () => {
  it('delegates to HealthService', () => {
    const controller = new HealthController(new HealthService());
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
