import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  CreateKnowledgeSourceRequestSchema,
  UpdateKnowledgeSourceRequestSchema,
  type CreateKnowledgeSourceRequest,
  type UpdateKnowledgeSourceRequest,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { AdminJwtGuard } from '../../../common/auth/admin-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { IfMatch } from '../../../common/http/if-match.decorator';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { CreateKnowledgeSourceUseCase } from '../application/create-knowledge-source.use-case';
import { ListKnowledgeSourcesUseCase } from '../application/list-knowledge-sources.use-case';
import { GetKnowledgeSourceUseCase } from '../application/get-knowledge-source.use-case';
import { UpdateKnowledgeSourceUseCase } from '../application/update-knowledge-source.use-case';
import { DeleteKnowledgeSourceUseCase } from '../application/delete-knowledge-source.use-case';
import { EstimateReindexUseCase } from '../application/estimate-reindex.use-case';
import { TriggerReindexUseCase } from '../application/trigger-reindex.use-case';

/** Matches this module's own 10 MiB upload cap (`assertUploadFile`) — enforced again here at the multer layer. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Knowledge-source (RAG ingestion) HTTP surface (Phase 12a, BL-044/046).
 * Nested under `/tenants/:id` exactly like `tools`/`deployment-config` so the
 * global `TenantContextInterceptor` scopes correctly. Every route: validate
 * -> call exactly one use-case -> map result — no business logic here.
 */
@Controller('tenants/:id/knowledge-sources')
@UseGuards(AdminJwtGuard, RolesGuard)
export class KnowledgeSourcesController {
  constructor(
    private readonly createSource: CreateKnowledgeSourceUseCase,
    private readonly listSources: ListKnowledgeSourcesUseCase,
    private readonly getSource: GetKnowledgeSourceUseCase,
    private readonly updateSource: UpdateKnowledgeSourceUseCase,
    private readonly deleteSource: DeleteKnowledgeSourceUseCase,
    private readonly estimateReindex: EstimateReindexUseCase,
    private readonly triggerReindex: TriggerReindexUseCase,
  ) {}

  /** POST /api/tenants/:id/knowledge-sources (multipart; 201 — Nest's default for @Post) */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  create(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(new TypeBoxValidationPipe(CreateKnowledgeSourceRequestSchema, 'KNOWLEDGE_SOURCE_NAME_REQUIRED'))
    body: CreateKnowledgeSourceRequest,
  ) {
    return this.createSource.execute(actor, tenantId, body, file);
  }

  /** GET /api/tenants/:id/knowledge-sources */
  @Get()
  list(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string) {
    return this.listSources.execute(actor, tenantId);
  }

  /** GET /api/tenants/:id/knowledge-sources/:sourceId */
  @Get(':sourceId')
  get(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('sourceId') sourceId: string) {
    return this.getSource.execute(actor, tenantId, sourceId);
  }

  /** PATCH /api/tenants/:id/knowledge-sources/:sourceId */
  @Patch(':sourceId')
  update(
    @CurrentUser() actor: AdminActor,
    @Param('id') tenantId: string,
    @Param('sourceId') sourceId: string,
    @Body(new TypeBoxValidationPipe(UpdateKnowledgeSourceRequestSchema, 'KNOWLEDGE_SOURCE_NAME_REQUIRED'))
    body: UpdateKnowledgeSourceRequest,
    @IfMatch() ifMatch: string,
  ) {
    return this.updateSource.execute(actor, tenantId, sourceId, body, ifMatch);
  }

  /** DELETE /api/tenants/:id/knowledge-sources/:sourceId */
  @Delete(':sourceId')
  @HttpCode(204)
  async remove(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('sourceId') sourceId: string) {
    await this.deleteSource.execute(actor, tenantId, sourceId);
  }

  /** GET /api/tenants/:id/knowledge-sources/:sourceId/reindex-estimate — no side effects. */
  @Get(':sourceId/reindex-estimate')
  reindexEstimate(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('sourceId') sourceId: string) {
    return this.estimateReindex.execute(actor, tenantId, sourceId);
  }

  /** POST /api/tenants/:id/knowledge-sources/:sourceId/reindex — the confirm step; enqueues only. */
  @Post(':sourceId/reindex')
  @HttpCode(202)
  reindex(@CurrentUser() actor: AdminActor, @Param('id') tenantId: string, @Param('sourceId') sourceId: string) {
    return this.triggerReindex.execute(actor, tenantId, sourceId);
  }
}
