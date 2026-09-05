import type { DataSource, Repository } from 'typeorm';
import { AiCallLogEntity } from '@/server/infrastructure/database';

/**
 * Data access for the tenant-scoped `ai_call_log` table — adapted from
 * `legacy/api/src/infrastructure/ai/ai-service/ai-call-log.repository.ts`. Deliberately its own tiny
 * repository (not folded into anything else) — `ai_call_log` rows are written for every AI call
 * regardless of whether a `pdf_processing_session` exists at all. Uses the literal table-name string
 * form (never the entity class) per this app's cross-webpack-bundle TypeORM fix.
 */
export class AiCallLogRepository {
  private readonly repo: Repository<AiCallLogEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository<AiCallLogEntity>('ai_call_log');
  }

  async insert(entity: AiCallLogEntity): Promise<void> {
    await this.repo.insert(entity);
  }
}
