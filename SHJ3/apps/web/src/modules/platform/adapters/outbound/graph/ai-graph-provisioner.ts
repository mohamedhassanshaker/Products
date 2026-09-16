/**
 * Neo4j limb of tenant provisioning — RB-09 step 2, RB-10 reverse step 2, RB-11 check 5.
 *
 * ## READ THIS BEFORE "SIMPLIFYING" IT
 *
 * This adapter holds **no Neo4j driver**, and that is not an oversight or a layer of
 * indirection someone forgot to remove. It is ADR-0003's ownership rule:
 *
 *   * Neo4j is written by `shj3-ai` and read by `shj3-ai`. *"The web tier never opens a
 *     graph or vector connection."* Single-writer ownership is what makes reconciling two
 *     derived indexes against the system of record tractable.
 *   * deployment.md §7.7 encodes the same rule as infrastructure: the NetworkPolicy admits
 *     Neo4j ingress from pods labelled `shj3-ai` and `shj3-worker` only. A driver added
 *     here would fail to connect in every deployed environment, and would pass locally —
 *     the worst possible way to discover the rule.
 *   * ADR-0009 rule 1 puts every Cypher statement inside the tenant-aware builder, which
 *     lives in `shj3-ai`. The `no-raw-cypher` gate fails the build if Cypher appears
 *     anywhere else, and `no-unscoped-store-clients` fails it if a Neo4j driver is
 *     constructed outside that service's graph adapter.
 *
 * So the work happens on the far side and this file is a typed HTTP call. Replacing it
 * with a driver would defeat three controls at once and break the deployed system.
 *
 * ## Why the far side, not this one, proves erasure
 *
 * ADR-0009 replaced `DROP DATABASE` with a batched filtered delete, so completeness has to
 * be *demonstrated* rather than inherited from the operation (rule 6). The proof is two
 * count assertions against both encodings, and both counts are only obtainable from a
 * Cypher session — which exists only in `shj3-ai`. This adapter's `verify` therefore
 * forwards a question rather than answering one, and the far side returns the counts it
 * asserted so they can be quoted in the de-provisioning attestation (RB-12).
 */

import type { ProvisioningStore } from "../../../domain/tenant.js";
import type { StoreProvisioner } from "../../../ports/provisioning.js";
import { assertValidSlugShape, type TenantSlug } from "../../../tenancy/tenant-slug.js";
import { getAiClient, type AiClient } from "../ai-client.js";

const BASE_PATH = "/internal/provisioning/graph";

/** What the far side reports after creating a tenant's label-scoped schema objects. */
interface GraphCreateResponse {
  readonly indexesCreated: number;
}

/**
 * The erasure proof (ADR-0009 rule 6). Both counts must be zero, and both are carried back
 * so RB-12's attestation can quote them rather than restate "we ran the delete".
 */
interface GraphDestroyResponse {
  readonly nodesByLabel: number;
  readonly nodesByProperty: number;
}

interface GraphVerifyResponse {
  readonly verified: boolean;
}

export class AiGraphProvisioner implements StoreProvisioner {
  readonly store: ProvisioningStore = "Neo4j";

  private readonly client: AiClient;

  constructor(client: AiClient = getAiClient()) {
    this.client = client;
  }

  async create(tenant: TenantSlug): Promise<void> {
    await this.client.post<GraphCreateResponse>(`${BASE_PATH}/create`, this.payload(tenant));
  }

  async destroy(tenant: TenantSlug): Promise<void> {
    const proof = await this.client.post<GraphDestroyResponse>(
      `${BASE_PATH}/destroy`,
      this.payload(tenant),
    );

    // The far side already refuses to report success with residue, so reaching here with a
    // non-zero count means the two services disagree about what erased means. Failing on
    // this side as well is cheap, and an unread proof is not a proof.
    if (proof.nodesByLabel !== 0 || proof.nodesByProperty !== 0) {
      throw new Error(
        `Graph erasure for "${tenant}" is incomplete: ${proof.nodesByLabel} node(s) still carry ` +
          `the tenant label and ${proof.nodesByProperty} still carry the tenant_id property. ` +
          "Under ADR-0009 this is a filtered delete, so completeness is asserted rather than " +
          "guaranteed — a non-zero count is a write-path defect and must not be retried away.",
      );
    }
  }

  async verify(tenant: TenantSlug): Promise<boolean> {
    const result = await this.client.post<GraphVerifyResponse>(
      `${BASE_PATH}/verify`,
      this.payload(tenant),
    );
    return result.verified;
  }

  /**
   * The request body.
   *
   * The slug is re-asserted rather than trusted, even though it arrives branded. On the far
   * side it becomes a `:Tenant_<slug>` label — an identifier position with no parameter
   * binding, in the one store that has neither a database boundary nor RBAC beneath it
   * (RISK-024). The far side validates it again through `TenantSlug`; sending a value that
   * would fail there is a bug worth catching before it crosses a network boundary.
   */
  private payload(tenant: TenantSlug): Record<string, unknown> {
    return { tenantSlug: assertValidSlugShape(tenant) };
  }
}
