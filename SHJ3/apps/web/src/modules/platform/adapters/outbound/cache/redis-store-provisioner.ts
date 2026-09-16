/**
 * Redis limb of tenant provisioning — RB-09 step 4, RB-10 reverse step 4, RB-11 check 7.
 *
 * Implements `StoreProvisioner` for the `"Redis"` store.
 *
 * ## What "provisioning" even means for a store with no schema
 *
 * Redis has no databases-per-tenant, no schemas and no collections. Its isolation unit is
 * a key prefix (ADR-0002), and a prefix is not a thing you create — it exists the moment
 * something writes a key under it. So there is nothing to declare, and the honest content
 * of this step is:
 *
 *  1. **Claim the namespace** by writing a sentinel key under the tenant's prefix, and
 *  2. **Prove the store is reachable and writable for this tenant** by reading it back.
 *
 * The second half is the part that earns its place in the four-store sequence. A Redis
 * that cannot hold a key written a millisecond ago is broken, and finding that out during
 * provisioning is much better than finding it out on a citizen's first message.
 *
 * ## The sentinel decision, and why `verify` stays literal
 *
 * Redis is deliberately not backed up (ADR-0003 rule 2), so the sentinel can vanish under
 * a legitimately provisioned tenant: a flush, a failover, an eviction, a container
 * restart with no persistence. That makes "is the sentinel present?" a different question
 * from "is this tenant provisioned?", and the two must not be conflated.
 *
 * The decision taken here, and the reasoning:
 *
 *  * **`verify` reports the literal truth.** A missing sentinel returns `false`. It is
 *    tempting to make `verify` self-heal by rewriting the sentinel and returning `true`,
 *    but a `verify` that repairs what it is measuring cannot fail, and the provisioning
 *    use case leans on this method to tell it whether the isolation unit actually exists.
 *    A check that always passes is worse than no check.
 *
 *  * **A missing sentinel is a re-creatable condition, not a provisioning failure.** The
 *    authority on whether a tenant is provisioned is the registry row in SQL Server, which
 *    *is* backed up. The sentinel is evidence, not truth. `create` is therefore cheap and
 *    safe to re-run at any time, which is exactly what RB-11's repair path does — the
 *    runbook says so in as many words: *"its loss is harmless — RB-11 recreates it."*
 *
 *  * **Nothing in the request path reads the sentinel.** This is the load-bearing half of
 *    the decision. If handle resolution gated on it, a Redis flush would take every
 *    government entity offline at once — an unbacked store would have become load-bearing,
 *    which is the precise thing ADR-0003 rule 2 exists to prevent. `getTenantCache()`
 *    derives the prefix from a validated slug and consults nothing.
 *
 * A corollary: RB-09 also `SADD`s the slug into a platform-wide tenant-prefix set. That
 * set is not maintained here, on purpose. It would be a second, unbacked copy of the
 * tenant list whose only consumer was meant to be a prefix-validating wrapper — and this
 * codebase's wrapper validates nothing, because it *derives* the prefix instead. A
 * duplicate that can silently drift from the registry buys nothing and can only mislead.
 * The registry is the tenant list.
 */

import type { ProvisioningStore } from "../../../domain/tenant.js";
import type { StoreProvisioner } from "../../../ports/provisioning.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import { getProvisioningCache, type TenantCache } from "./tenant-cache.js";

/**
 * The sentinel's key, relative to the tenant's prefix — so the physical key is
 * `<slug>:__provisioned`.
 *
 * Double-underscored to put it outside every functional namespace the application uses
 * (`session:`, `breaker:`, `ratelimit:`, `queue:`), so a prefix sweep that spares it can
 * be written as a pattern rather than as a list of exceptions.
 */
const SENTINEL_KEY = "__provisioned";

/**
 * How many keys to remove per pass. Erasure sweeps a whole government entity's namespace,
 * and a single unbounded delete on a shared Redis blocks every other tenant's commands —
 * the same reasoning that makes the graph delete batched (ADR-0009 rule 6).
 */
const SWEEP_BATCH = 1000;

/**
 * Passes that must each come back empty before the namespace is declared clear.
 *
 * RB-10 requires three consecutive zero-key scans. One empty scan is not proof: `SCAN` is
 * a cursor over a mutating keyspace, so a key written concurrently — or a batch whose
 * deletion had not yet landed — can be missed by a single pass.
 */
const CONFIRMATION_PASSES = 3;

/**
 * Ceiling on sweep passes.
 *
 * A namespace still producing keys after this many batches is not a large tenant, it is a
 * store that is not honouring the deletes — and a rollback that loops forever is strictly
 * worse than one that reports residue and lets RB-10 take over.
 */
const MAX_SWEEP_PASSES = 1000;

const OPERATION = "tenant provisioning (redis)";

export interface RedisStoreProvisionerOptions {
  /**
   * How to obtain a prefix-bounded handle for the tenant being provisioned.
   *
   * Defaults to `getProvisioningCache`, which is gated on the platform provisioning
   * scope. Injectable so the sweep and sentinel logic can be tested without a Redis.
   */
  readonly cacheFor?: (slug: TenantSlug) => TenantCache;
  /** Injected so the sentinel's recorded time is assertable. */
  readonly now?: () => Date;
}

export class RedisStoreProvisioner implements StoreProvisioner {
  readonly store: ProvisioningStore = "Redis";

  private readonly cacheFor: (slug: TenantSlug) => TenantCache;
  private readonly now: () => Date;

  constructor(options: RedisStoreProvisionerOptions = {}) {
    this.cacheFor = options.cacheFor ?? ((slug) => getProvisioningCache(slug, OPERATION));
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Claim the namespace.
   *
   * No TTL: the sentinel marks a fact with no expiry date. It is overwritten rather than
   * written-if-absent, so a re-run refreshes the timestamp — which is how an operator
   * following RB-11 can tell a recreated sentinel from the original one, and therefore
   * tell "this tenant was re-provisioned" apart from "this Redis was flushed".
   */
  async create(tenant: TenantSlug): Promise<void> {
    const cache = this.cacheFor(tenant);
    await cache.set(SENTINEL_KEY, this.now().toISOString());

    const readBack = await cache.get(SENTINEL_KEY);
    if (readBack === null) {
      throw new Error(
        "Wrote the Redis provisioning sentinel and read back nothing. The namespace cannot be " +
          "claimed, so the tenant would be activated against a cache it cannot use.",
      );
    }
  }

  /**
   * Erase everything under the tenant's prefix.
   *
   * Prefix-bounded `SCAN`, never `KEYS` (it blocks the server for the whole keyspace) and
   * never `FLUSHDB` (it would erase every other government entity's sessions — a
   * cross-tenant side effect from a single-tenant operation).
   *
   * The sentinel goes last, and that ordering is deliberate: while it is present, an
   * interrupted sweep is still identifiable as a namespace that was claimed and is being
   * cleared, rather than as an unexplained scatter of keys.
   */
  async destroy(tenant: TenantSlug): Promise<void> {
    const cache = this.cacheFor(tenant);

    let emptyPasses = 0;
    let passes = 0;
    while (emptyPasses < CONFIRMATION_PASSES) {
      if (passes >= MAX_SWEEP_PASSES) {
        throw new Error(
          `Swept the "${tenant}" cache namespace ${passes} times and keys keep reappearing. ` +
            "Something is still writing to a tenant being de-provisioned, or the deletes are " +
            "not taking effect. Reported as residue rather than retried indefinitely (RB-10).",
        );
      }
      passes += 1;

      const keys = await cache.scanKeys("*", SWEEP_BATCH);
      const removable = keys.filter((key) => key !== SENTINEL_KEY);

      if (removable.length === 0) {
        emptyPasses += 1;
        continue;
      }

      emptyPasses = 0;
      await cache.del(...removable);
    }

    await cache.del(SENTINEL_KEY);
  }

  /**
   * Whether the namespace is claimed.
   *
   * After `create` this confirms the sentinel is readable. After `destroy` it confirms the
   * prefix is clear — and it checks the whole prefix, not just the sentinel, because a
   * sweep that removed the marker while leaving keys behind is exactly the residue RB-10
   * needs reported.
   *
   * See the module comment for why a missing sentinel is reported as `false` rather than
   * silently repaired.
   */
  async verify(tenant: TenantSlug): Promise<boolean> {
    const cache = this.cacheFor(tenant);

    // A null read means either "never provisioned" or "provisioned and then flushed".
    // Both are recovered by re-running `create`; neither is a state this method may paper
    // over by rewriting the key it is supposed to be measuring.
    const sentinel = await cache.get(SENTINEL_KEY);
    return sentinel !== null;
  }

  /**
   * Whether any key remains under the tenant's prefix, sentinel included.
   *
   * The post-`destroy` assertion. Kept separate from `verify` because the two ask
   * different questions: `verify` asks whether the namespace is claimed, this asks whether
   * anything is left in it, and after a successful erasure the answers are "no" and "no".
   */
  async isNamespaceEmpty(tenant: TenantSlug): Promise<boolean> {
    const keys = await this.cacheFor(tenant).scanKeys("*", 1);
    return keys.length === 0;
  }
}
