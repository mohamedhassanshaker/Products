import { Module } from '@nestjs/common';
import { HealthService } from './application/health.service';
import { HealthController } from './interface/health.controller';

/**
 * Platform kernel: health, config, OpenAPI (wired in AppModule).
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class PlatformModule {}
