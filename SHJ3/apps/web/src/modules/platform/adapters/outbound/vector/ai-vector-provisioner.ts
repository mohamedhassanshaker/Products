/**
 * Qdrant limb of tenant provisioning — RB-09 step 3, RB-10 reverse step 3, RB-11 check 6.
 *
 * ## READ THIS BEFORE "SIMPLIFYING" IT
 *
 * This adapter holds **no Qdrant client**, for the same reason its graph sibling holds no
 * Neo4j driver. ADR-0003 gives Qdrant to `shj3-ai` as its sole writer; deployment.md §7.7
 * admits Qdrant ingress from `shj3-ai` and `shj3-worker` pods only, so a client here would
 * work in local development and fail in every deployed environment; and
 * `no-unscoped-store-clients` fails the build if one is constructed outside
 * `apps/ai/src/shj3_ai/adapters/outbound/vector/`. The indirection is the architecture,
 * not an accident of it.
 *
 * ## The embedding model and dimension are part of provisioning, not of ingest
 *
 * A collection is created for a specific embedding model at a specific dimension, and
 * changing either invalidates every vector already in it. The failure mode is what makes
 * this worth stating: a dimension mismatch is rejected by Qdrant and is therefore loud,
 * but a *model* mismatch at the same dimension is accepted silently and simply returns
 * worse neighbours — retrieval is poisoned rather than broken (ADR-0004 rule 3, RISK-016).
 * Nobody notices from an error log.
 *
 * So the pair is recorded **on the collection** at creation, `shj3-ai` asserts at boot that
 * its configured dimension equals every active tenant's recorded one and refuses to start
 * on mismatch, and `verify` re-checks the recorded pair rather than only the collection's
 * existence. RB-09 puts it plainly: *"they are not recoverable later by inspection."*
 *
 * ## Where the pair comes from, and the port's rough edge
 *
 * `StoreProvisioner.create(tenant)` receives a slug and nothing else — correctly, because
 * three of the four stores need nothing else. This one does, and the values belong to the
 * tenant being provisioned (`ProvisionTenantInput` carries them, and the registry row
 * records them). They therefore arrive by constructor: the provisioning entry point builds
 * one instance per run, from the same values it registered, so the collection and the
 * registry row cannot disagree. Widening the port for one store's needs would have put an
 * unused parameter on the other three.
 */

import type { ProvisioningStore } from "../../../domain/tenant.js";
import type { StoreProvisioner } from "../../../ports/provisioning.js";
import { assertValidSlugShape, type TenantSlug } from "../../../tenancy/tenant-slug.js";
import { getAiClient, type AiClient } from "../ai-client.js";

const BASE_PATH = "/internal/provisioning/vector";

export interface AiVectorProvisionerConfig {
  /** The model that will populate the collection, e.g. `text-embedding-3-large`. */
  readonly embeddingModel: string;
  /** Its output dimension. Recorded so a later mismatch fails rather than degrades. */
  readonly embeddingDimensions: number;
}

interface VectorCreateResponse {
  readonly collection: string;
}

interface VectorVerifyResponse {
  readonly verified: boolean;
}

export class AiVectorProvisioner implements StoreProvisioner {
  readonly store: ProvisioningStore = "Qdrant";

  private readonly client: AiClient;
  private readonly config: AiVectorProvisionerConfig;

  constructor(config: AiVectorProvisionerConfig, client: AiClient = getAiClient()) {
    if (!Number.isInteger(config.embeddingDimensions) || config.embeddingDimensions <= 0) {
      throw new Error(
        `Refusing to provision a Qdrant collection with dimension ${config.embeddingDimensions}. ` +
          "The dimension is fixed at collection creation and every vector written afterwards " +
          "depends on it (ADR-0004 rule 3).",
      );
    }
    if (config.embeddingModel.trim().length === 0) {
      throw new Error(
        "Refusing to provision a Qdrant collection with no embedding model recorded. A model " +
          "mismatch at the same dimension is accepted silently by Qdrant and degrades retrieval " +
          "instead of failing it (RISK-016), so the model name is the only thing that makes the " +
          "mismatch detectable.",
      );
    }
    this.config = config;
    this.client = client;
  }

  async create(tenant: TenantSlug): Promise<void> {
    await this.client.post<VectorCreateResponse>(`${BASE_PATH}/create`, {
      ...this.payload(tenant),
      embeddingModel: this.config.embeddingModel,
      embeddingDimensions: this.config.embeddingDimensions,
    });
  }

  async destroy(tenant: TenantSlug): Promise<void> {
    await this.client.post<Record<string, never>>(`${BASE_PATH}/destroy`, this.payload(tenant));
  }

  /**
   * Prove the collection exists, is serving, and remembers what produced it.
   *
   * The expected pair is sent so the far side compares rather than reports: a collection
   * whose recorded model differs from the one about to write into it is exactly the silent
   * poisoning this pair exists to catch, and it must fail provisioning rather than be
   * returned as a field somebody has to remember to check.
   */
  async verify(tenant: TenantSlug): Promise<boolean> {
    const result = await this.client.post<VectorVerifyResponse>(`${BASE_PATH}/verify`, {
      ...this.payload(tenant),
      embeddingModel: this.config.embeddingModel,
      embeddingDimensions: this.config.embeddingDimensions,
    });
    return result.verified;
  }

  /**
   * The slug is re-asserted before it crosses the hop: on the far side it is derived into
   * the collection name, and *"the collection name is derived, never taken from input —
   * that is the whole defence against a crafted collection reference"* (api.md §5).
   */
  private payload(tenant: TenantSlug): Record<string, unknown> {
    return { tenantSlug: assertValidSlugShape(tenant) };
  }
}
