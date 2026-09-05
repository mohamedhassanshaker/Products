import { Inject, Injectable, Logger } from '@nestjs/common';
import { UTTERANCE_REPOSITORY, type UtteranceRepositoryPort } from '../../sessions';

/**
 * Daily retention purge (FR-PRIV-3). Called by the `jobs` module's
 * `transcript-purge` repeatable BullMQ job. Idempotent by construction — the
 * underlying raw update only ever touches `transcript_purged = false` rows.
 */
@Injectable()
export class PurgeExpiredTranscriptsUseCase {
  private readonly logger = new Logger(PurgeExpiredTranscriptsUseCase.name);

  constructor(@Inject(UTTERANCE_REPOSITORY) private readonly utterances: UtteranceRepositoryPort) {}

  /** @returns Number of sessions purged in this run */
  async execute(): Promise<number> {
    const purged = await this.utterances.purgeExpired();
    if (purged > 0) {
      this.logger.log({ purged }, 'transcript-purge run complete');
    }
    return purged;
  }
}
