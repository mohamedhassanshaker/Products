import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions';
import { PublicController } from './interface/public.controller';

/**
 * Interface-only module (LLD §3.1) exposing the unauthenticated end-user
 * surface. Composes `sessions` module use cases; owns no domain/application
 * of its own.
 */
@Module({
  imports: [SessionsModule],
  controllers: [PublicController],
})
export class PublicModule {}
