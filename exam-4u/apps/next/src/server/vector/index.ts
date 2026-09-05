import { VectorBootstrapService, createVectorBootstrapService } from './application/vector-bootstrap.service';
import { VectorCollectionMetaRepository } from './infrastructure/vector-collection-meta.repository';

export { VectorBootstrapService, createVectorBootstrapService, VectorCollectionMetaRepository };
export type {
  ChunkFilter,
  DeleteQuestionsFilter,
  QuestionFilter,
  ScoredPoint,
  ScrollOptions,
  TenantScope,
  VectorPoint,
  VectorStorePort,
} from './domain/vector-store.port';
export type { EmbeddingsPort } from './domain/embeddings.port';

/**
 * `server/vector`'s public barrel (migration plan Phase 5) — `VectorStorePort`/`EmbeddingsPort`
 * (the two ports application code depends on), `VectorBootstrapService` (the boot-time
 * collection/drift-guard bootstrap), and `VectorCollectionMetaRepository`. Nothing outside this
 * module may import `./domain/**`/`./application/**`/`./infrastructure/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `vector` module-boundary rule).
 *
 * The concrete `VectorStorePort` implementation (`QdrantVectorStoreAdapter`) and concrete
 * `EmbeddingsPort` implementations live in their own sibling modules
 * (`server/infrastructure/vector`, `server/infrastructure/embeddings`) — this module owns only the
 * port contracts + the bootstrap logic that depends on both, mirroring legacy's identical
 * `vector/` vs `infrastructure/vector` split.
 */
