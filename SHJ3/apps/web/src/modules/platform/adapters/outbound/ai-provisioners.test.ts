import { describe, expect, it, vi } from "vitest";
import { PROVISIONING_STORES } from "../../domain/tenant.js";
import { assertValidSlugShape, InvalidTenantSlugError } from "../../tenancy/tenant-slug.js";
import type { TenantSlug } from "../../tenancy/tenant-slug.js";
import type { AiClient } from "./ai-client.js";
import { AiGraphProvisioner } from "./graph/ai-graph-provisioner.js";
import { AiVectorProvisioner } from "./vector/ai-vector-provisioner.js";

/**
 * Tests for the two provisioners that reach their store through `shj3-ai`.
 *
 * The structural claim these files make — that the web tier holds no Neo4j or Qdrant
 * client (ADR-0003, deployment.md §7.7) — is enforced by the `no-unscoped-store-clients`
 * gate rather than by a test, which is the right place for it. What is tested here is what
 * the gate cannot see:
 *
 *  * the slug is re-asserted before it crosses the hop, because on the far side it becomes
 *    a Cypher label and a collection name — identifier positions in the two stores with no
 *    database boundary beneath them;
 *  * `destroy` refuses to treat a non-zero erasure count as success (ADR-0009 rule 6);
 *  * the embedding model and dimension travel with every vector call, because a
 *    same-dimension model swap is accepted silently and poisons retrieval (RISK-016).
 *
 * Covers FR-PLAT-02 and FR-PLAT-04.
 */

const SEWA = assertValidSlugShape("sewa");
const CONTRACT = { embeddingModel: "text-embedding-3-large", embeddingDimensions: 3072 };

function clientReturning(...responses: unknown[]): AiClient & { post: ReturnType<typeof vi.fn> } {
  const post = vi.fn();
  for (const response of responses) post.mockResolvedValueOnce(response);
  post.mockResolvedValue({});
  return { post };
}

function forge(value: string): TenantSlug {
  return value as unknown as TenantSlug;
}

describe("AiGraphProvisioner", () => {
  it("declares the Neo4j store, which is what orders it second", () => {
    expect(new AiGraphProvisioner(clientReturning()).store).toBe("Neo4j");
    expect(PROVISIONING_STORES).toContain("Neo4j");
  });

  it("creates through the internal provisioning endpoint", async () => {
    const client = clientReturning({ indexesCreated: 3 });

    await new AiGraphProvisioner(client).create(SEWA);

    expect(client.post).toHaveBeenCalledWith("/internal/provisioning/graph/create", {
      tenantSlug: "sewa",
    });
  });

  it("verifies through the internal provisioning endpoint", async () => {
    const client = clientReturning({ verified: false });

    expect(await new AiGraphProvisioner(client).verify(SEWA)).toBe(false);
    expect(client.post).toHaveBeenCalledWith("/internal/provisioning/graph/verify", {
      tenantSlug: "sewa",
    });
  });

  it("accepts a destroy whose proof is zero under both encodings", async () => {
    const client = clientReturning({ nodesByLabel: 0, nodesByProperty: 0 });

    await expect(new AiGraphProvisioner(client).destroy(SEWA)).resolves.toBeUndefined();
  });

  it.each([
    { encoding: "label", proof: { nodesByLabel: 4, nodesByProperty: 0 } },
    { encoding: "property", proof: { nodesByLabel: 0, nodesByProperty: 4 } },
    { encoding: "both", proof: { nodesByLabel: 4, nodesByProperty: 4 } },
  ])("refuses a destroy with residue under the $encoding encoding", async ({ proof }) => {
    // The whole point of ADR-0009 rule 6: this is a filtered delete, so completeness is
    // asserted rather than guaranteed, and an unread proof is not a proof.
    const client = clientReturning(proof);

    await expect(new AiGraphProvisioner(client).destroy(SEWA)).rejects.toThrow(/incomplete/);
  });

  it("says not to retry away a non-zero count", async () => {
    const client = clientReturning({ nodesByLabel: 0, nodesByProperty: 2 });

    await expect(new AiGraphProvisioner(client).destroy(SEWA)).rejects.toThrow(
      /must not be retried away/,
    );
  });

  it("re-asserts the slug before it can reach a Cypher label", async () => {
    const client = clientReturning();
    const provisioner = new AiGraphProvisioner(client);

    await expect(provisioner.create(forge("Tenant_x) DETACH DELETE n //"))).rejects.toThrow(
      InvalidTenantSlugError,
    );
    expect(client.post).not.toHaveBeenCalled();
  });

  it("re-asserts the slug on destroy and verify too", async () => {
    const client = clientReturning();
    const provisioner = new AiGraphProvisioner(client);

    await expect(provisioner.destroy(forge("platform"))).rejects.toThrow(InvalidTenantSlugError);
    await expect(provisioner.verify(forge("sewa-customs"))).rejects.toThrow(InvalidTenantSlugError);
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe("AiVectorProvisioner", () => {
  it("declares the Qdrant store, which is what orders it third", () => {
    expect(new AiVectorProvisioner(CONTRACT, clientReturning()).store).toBe("Qdrant");
    expect(PROVISIONING_STORES).toContain("Qdrant");
  });

  it("sends the embedding contract on create", async () => {
    // Recorded on the collection, because it is not recoverable later by inspection
    // (RB-09 step 3).
    const client = clientReturning({ collection: "sewa_knowledge" });

    await new AiVectorProvisioner(CONTRACT, client).create(SEWA);

    expect(client.post).toHaveBeenCalledWith("/internal/provisioning/vector/create", {
      tenantSlug: "sewa",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3072,
    });
  });

  it("sends the embedding contract on verify, so the far side compares rather than reports", async () => {
    const client = clientReturning({ verified: true });

    await new AiVectorProvisioner(CONTRACT, client).verify(SEWA);

    expect(client.post).toHaveBeenCalledWith("/internal/provisioning/vector/verify", {
      tenantSlug: "sewa",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3072,
    });
  });

  it("forwards a failed verification rather than assuming success", async () => {
    const client = clientReturning({ verified: false });

    expect(await new AiVectorProvisioner(CONTRACT, client).verify(SEWA)).toBe(false);
  });

  it("destroys through the internal provisioning endpoint", async () => {
    const client = clientReturning({});

    await new AiVectorProvisioner(CONTRACT, client).destroy(SEWA);

    expect(client.post).toHaveBeenCalledWith("/internal/provisioning/vector/destroy", {
      tenantSlug: "sewa",
    });
  });

  it.each([0, -1, 1536.5, Number.NaN])(
    "refuses to be constructed with dimension %s",
    (embeddingDimensions) => {
      // The dimension is fixed at collection creation and every vector written afterwards
      // depends on it, so a nonsensical one must fail before a collection exists.
      expect(
        () =>
          new AiVectorProvisioner(
            { embeddingModel: "text-embedding-3-large", embeddingDimensions },
            clientReturning(),
          ),
      ).toThrow(/dimension/);
    },
  );

  it("refuses to be constructed with no embedding model recorded", () => {
    expect(
      () =>
        new AiVectorProvisioner(
          { embeddingModel: "  ", embeddingDimensions: 3072 },
          clientReturning(),
        ),
    ).toThrow(/RISK-016/);
  });

  it("re-asserts the slug before it can reach a collection name", async () => {
    const client = clientReturning();
    const provisioner = new AiVectorProvisioner(CONTRACT, client);

    await expect(provisioner.create(forge("../other_knowledge"))).rejects.toThrow(
      InvalidTenantSlugError,
    );
    expect(client.post).not.toHaveBeenCalled();
  });
});
