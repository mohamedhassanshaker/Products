import type { ReviewerGroupDto } from '@liveavatar/contracts';
import type { ReviewerGroupRecord } from '../domain/reviewer-group';

/** Maps a `ReviewerGroup` record to its wire DTO. */
export function toReviewerGroupDto(record: ReviewerGroupRecord): ReviewerGroupDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    name: record.name,
    members: record.members,
    notification_channels: record.notificationChannels,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
