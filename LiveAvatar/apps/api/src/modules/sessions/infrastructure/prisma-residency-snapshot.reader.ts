import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ResidencySnapshotReaderPort } from '../domain/ports';
import type { ResidencySnapshot } from '../domain/session';

/** Platform default when a tenant somehow has no residency row (should not happen — Phase 1 creates one). */
const DEFAULT_RESIDENCY_SNAPSHOT: ResidencySnapshot = {
  sendToRemoteLlm: 'prompt_text_only',
  retainTranscriptsDays: 90,
  recordingsEnabled: false,
};

/**
 * Reads `DataResidencyPolicy` directly (no `residency` module exists before
 * Phase 7/BL-024) to snapshot it onto a new `Session` row at start (FR-PRIV-2:
 * "snapshot at session start", never a live read mid-session).
 */
@Injectable()
export class PrismaResidencySnapshotReader implements ResidencySnapshotReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  /** @inheritdoc */
  async read(tenantId: string): Promise<ResidencySnapshot> {
    const row = await this.prisma.withBypass(() =>
      this.prisma.db.dataResidencyPolicy.findUnique({ where: { tenantId } }),
    );
    if (!row) {
      return DEFAULT_RESIDENCY_SNAPSHOT;
    }
    return {
      sendToRemoteLlm: row.sendToRemoteLlm,
      retainTranscriptsDays: row.retainTranscriptsDays,
      recordingsEnabled: row.recordingsEnabled,
    };
  }
}
