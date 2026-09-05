import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions';
import { TransportModule } from '../transport';
import { SESSION_SEARCH_REPOSITORY } from './domain/ports';
import { PrismaSessionSearchRepository } from './infrastructure/prisma-session-search.repository';
import { ListSessionsUseCase } from './application/list-sessions.use-case';
import { GetSessionUseCase } from './application/get-session.use-case';
import { GetTranscriptUseCase } from './application/get-transcript.use-case';
import { GetHopsUseCase } from './application/get-hops.use-case';
import { PurgeExpiredTranscriptsUseCase } from './application/purge-expired-transcripts.use-case';
import { SessionLogsController } from './interface/session-logs.controller';

/**
 * Session Logs bounded context (FR-SESS-1/2/3, FR-PRIV-3, Screen 5). Owns the
 * *read* side of `Session`/`TranscriptUtterance`/`LatencyHop` (the `sessions`
 * module owns the write/lifecycle side — see its telemetry-ports docstring)
 * plus the retention purge use case the `jobs` module's `transcript-purge`
 * processor calls. Depends one-directionally on `SessionsModule` (repository
 * ports) and `TransportModule` (`userIdentity`/`agentIdentity` helpers for
 * the detail view's participant list) — never the reverse.
 */
@Module({
  imports: [SessionsModule, TransportModule],
  controllers: [SessionLogsController],
  providers: [
    { provide: SESSION_SEARCH_REPOSITORY, useClass: PrismaSessionSearchRepository },
    ListSessionsUseCase,
    GetSessionUseCase,
    GetTranscriptUseCase,
    GetHopsUseCase,
    PurgeExpiredTranscriptsUseCase,
  ],
  exports: [PurgeExpiredTranscriptsUseCase],
})
export class SessionLogsModule {}
