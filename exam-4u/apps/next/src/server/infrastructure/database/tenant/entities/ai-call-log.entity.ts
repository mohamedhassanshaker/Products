import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `ai_call_log` table (migration plan Phase 5's own "AI cost
 * accounting" line) — ported verbatim from
 * `legacy/api/src/infrastructure/ai/ai-service/entities/ai-call-log.entity.ts`. `task` stores the
 * `AiOperation` string (`'classify-content'`, etc.) as a plain `varchar`, not an enum, so a future
 * operation never requires a migration just to log it.
 *
 * `processingSessionId` is nullable and carries no FK — some calls this table logs (e.g. a Prompt
 * Practice call) have no owning `pdf_processing_session` row at all (that table doesn't even exist
 * yet in `apps/next` — Phase 6's job).
 */
@Entity({ name: 'ai_call_log' })
export class AiCallLogEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'processing_session_id', type: 'char', length: 36, nullable: true })
  processingSessionId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  task!: string;

  @Column({ type: 'varchar', length: 120 })
  model!: string;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens!: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens!: number;

  @Column({ name: 'cost_usd', type: 'decimal', precision: 10, scale: 6, nullable: true })
  costUsd!: number | null;

  @Column({ name: 'cost_unavailable', type: 'tinyint', width: 1, default: 0 })
  costUnavailable!: boolean;

  @Column({ name: 'latency_ms', type: 'int' })
  latencyMs!: number;

  @Column({ type: 'enum', enum: ['Success', 'Failed'] })
  outcome!: 'Success' | 'Failed';

  @Column({ type: 'varchar', length: 500, nullable: true })
  error!: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 64, nullable: true })
  correlationId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
