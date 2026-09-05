import type { DeploymentConfigDto } from '@liveavatar/contracts';
import type { DeploymentConfigRecord } from '../domain/ports';

/** Maps a persisted record to its wire DTO. */
export function toDeploymentConfigDto(record: DeploymentConfigRecord): DeploymentConfigDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    yaml_text: record.yamlText,
    status: record.status,
    providers: {
      transport: record.providers.transport,
      stt: record.providers.stt,
      llm: record.providers.llm,
      llm_fallback: record.providers.llmFallback,
      tts: record.providers.tts,
      avatar: record.providers.avatar,
    },
    updated_at: record.updatedAt.toISOString(),
    updated_by: record.updatedBy,
    published_at: record.publishedAt ? record.publishedAt.toISOString() : null,
  };
}
