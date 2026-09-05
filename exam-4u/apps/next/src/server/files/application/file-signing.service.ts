import { createHmac, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { InternalDomainError, NotFoundDomainError } from '@/server/common/errors/domain-error';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { LinkInvalidOrExpiredError, PathTraversalRejectedError, StorageKeyNotOwnedError } from '../domain/errors';

/** A verified, ready-to-stream download target — everything the download Route Handler needs once
 * `verify()` has returned successfully. */
export interface VerifiedDownload {
  storageKey: string;
}

export interface FileSigningServiceConfig {
  /** `FILE_SIGNING_SECRET` — required in every deployed environment; `sign`/`verify` throw
   * {@link InternalDomainError} if it is unset when actually called. */
  signingSecret: string | undefined;
  /** `SIGNED_URL_TTL_SEC` — how long a freshly-signed URL stays valid. */
  signedUrlTtlSec: number;
}

/**
 * Implements the `sign`/`verify` pair — ported logic (not code) from
 * `legacy/api/src/modules/files/application/file-signing.service.ts`'s `FileSigningService`, adapted
 * from a NestJS `@Injectable()` (constructor-injected `AppConfigService`/`StoragePort`) to a plain
 * class taking already-resolved config/collaborators (this app's established composition-root
 * pattern). Purely a stateless crypto/authorization service sitting in front of {@link StoragePort} —
 * no repository, no tenant `DataSource` dependency at all.
 *
 * **Why HMAC over a bare "is this key under my tenant" check alone**: the signature also encodes an
 * expiry, so a link handed to a browser (e.g. an `<img src>`) is only usable for
 * `SIGNED_URL_TTL_SEC` (default 900s) — a leaked/cached URL from an old page load stops working
 * rather than staying a permanent, un-revocable path to the object.
 */
export class FileSigningService {
  constructor(
    private readonly config: FileSigningServiceConfig,
    private readonly storage: StoragePort,
  ) {}

  /**
   * `POST /api/files/sign`. Authorizes `callerTenantId` against `storageKey` (the *single*
   * authorization checkpoint for the whole signed-delivery mechanism) and, if allowed, mints a
   * time-limited, tamper-evident URL for it.
   *
   * **Authorization rule** (smallest reasonable choice consistent with "tenant id is part of every
   * storage key" — no finer-grained per-resource ownership check exists this phase): the key must be
   * namespaced under the caller's own resolved tenant (`tenants/{callerTenantId}/...`). Within their
   * own tenant, any authenticated user may sign any key that tenant owns.
   *
   * @throws {StorageKeyNotOwnedError} if `storageKey` is not namespaced under `callerTenantId`.
   */
  sign(storageKey: string, callerTenantId: string): { url: string; expiresAt: string } {
    const requiredPrefix = `tenants/${callerTenantId}/`;
    if (!storageKey.startsWith(requiredPrefix)) {
      throw new StorageKeyNotOwnedError('You are not permitted to access this file.');
    }

    const secret = this.requireSigningSecret();
    const ttlSec = this.config.signedUrlTtlSec;
    const expEpoch = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.computeSignature(storageKey, expEpoch, secret);

    // `encodeURIComponent` per path segment (not the whole key at once) so the `/` separators
    // survive as literal path segments in the resulting URL rather than being percent-encoded into
    // one opaque blob — the download route re-joins the wildcard's segments the same way.
    const encodedPath = storageKey.split('/').map(encodeURIComponent).join('/');
    const url = `/api/files/d/${encodedPath}?exp=${expEpoch}&sig=${sig}`;

    return { url, expiresAt: new Date(expEpoch * 1000).toISOString() };
  }

  /**
   * `GET /api/files/d/[...path]` verification (steps 1-3; streaming itself is the Route Handler's job
   * since it needs direct access to the Fetch `Response` for range handling).
   *
   * Order is deliberate and security-critical: the path-traversal check runs and can reject the
   * request *before* the signature is ever computed or compared, so a crafted `../`-style path never
   * benefits from — or needs — a valid-looking signature to be rejected. Only after that does this
   * method check expiry, then compare the signature with `timingSafeEqual` (never `===`, which would
   * leak timing information about how many leading bytes matched).
   *
   * @throws {PathTraversalRejectedError} if `rawPath` normalizes to something outside the storage
   *   key namespace (e.g. contains a `..` segment that would climb above the root).
   * @throws {LinkInvalidOrExpiredError} if `exp` is in the past, or `sig` does not match.
   */
  verify(rawPath: string, expParam: string, sigParam: string): VerifiedDownload {
    const storageKey = this.normalizeAndAssertSafe(rawPath);

    const expEpoch = Number(expParam);
    // `<=`, not `<`: a link is valid strictly *before* its expiry instant, never valid ON it.
    if (!Number.isFinite(expEpoch) || expEpoch <= Math.floor(Date.now() / 1000)) {
      throw new LinkInvalidOrExpiredError();
    }

    const secret = this.requireSigningSecret();
    const expected = this.computeSignature(storageKey, expEpoch, secret);
    if (!this.signaturesMatch(sigParam, expected)) {
      throw new LinkInvalidOrExpiredError();
    }

    return { storageKey };
  }

  /** Looks up size/content-type for an already-{@link verify}'d key, translating a missing object
   * into a generic {@link NotFoundDomainError} (distinct from `LINK_INVALID_OR_EXPIRED` — the
   * signature was genuinely valid, the object underneath is just gone). */
  async stat(storageKey: string): Promise<{ size: number; contentType: string }> {
    const stat = await this.storage.stat(storageKey);
    if (!stat) {
      throw new NotFoundDomainError('The requested file was not found.');
    }
    return stat;
  }

  /**
   * Normalizes `rawPath` (the decoded, slash-joined form of the wildcard route segments) using
   * POSIX path rules and asserts the result cannot climb outside the storage-key namespace — the
   * same "normalize+resolve; assert it stays under the root" invariant `LocalDiskStorageAdapter`
   * enforces for on-disk paths, applied here at the URL-path level before any filesystem call is
   * made at all.
   */
  private normalizeAndAssertSafe(rawPath: string): string {
    // Deliberately `posix.normalize` (forward-slash rules), never the platform-default `normalize` —
    // storage keys and URL paths are always `/`-separated regardless of the host OS this process
    // happens to run on.
    const normalized = posix.normalize(rawPath);
    if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('\0')) {
      throw new PathTraversalRejectedError();
    }
    return normalized;
  }

  private computeSignature(storageKey: string, expEpoch: number, secret: string): string {
    return createHmac('sha256', secret).update(`${storageKey}|${expEpoch}`).digest('base64url');
  }

  /** `timingSafeEqual` requires equal-length buffers; a length mismatch is itself proof of an
   * invalid signature, so it is treated as a mismatch rather than allowed to throw. */
  private signaturesMatch(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /** `FILE_SIGNING_SECRET` is `optional()` in `env.schema.ts` only so local dev without it doesn't
   * fail zod validation outright; it is unconditionally required in every deployed environment and
   * unconditionally required here — this module cannot sign or verify anything without it. */
  private requireSigningSecret(): string {
    const secret = this.config.signingSecret;
    if (!secret) {
      throw new InternalDomainError(new Error('FILE_SIGNING_SECRET is not configured.'));
    }
    return secret;
  }
}
