import { Module } from '@nestjs/common';
import { GpuModule } from './gpu.module';
import { GpuController } from './interface/gpu.controller';

/**
 * Thin interface-only module carrying the admin `GET /gpu/nodes` controller
 * (Screen 6). Imported only by `AppModule` (public `:8080` app) — see
 * `GpuModule`'s docstring for why the split exists.
 */
@Module({
  imports: [GpuModule],
  controllers: [GpuController],
})
export class GpuAdminModule {}
