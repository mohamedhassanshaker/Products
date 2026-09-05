import { Controller, Get } from '@nestjs/common';
import { HealthService } from '../application/health.service';

/**
 * Unauthenticated liveness endpoint.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /api/health */
  @Get()
  getHealth() {
    return this.health.getHealth();
  }
}
