import { DomainError, ForbiddenDomainError } from '@/server/common/errors/domain-error';

/**
 * `files`-module `DomainError` subclasses — ported verbatim from
 * `legacy/api/src/modules/files/domain/errors.ts`. Both codes already exist in
 * `@examland/contracts`'s error-code catalog — this module only adds the throw sites.
 */

/** `FileSigningService.verify()` step 1: the requested path, once normalized and resolved, would
 * escape the storage-key namespace. Deliberately checked and thrown *before* the signature is even
 * computed, so a crafted `../../etc/passwd`-style path is rejected on its own merits regardless of
 * whether it happens to carry a valid-looking `sig`/`exp` pair. */
export class PathTraversalRejectedError extends DomainError {
  constructor() {
    super('PATH_TRAVERSAL_REJECTED', 'The requested file path is not valid.');
  }
}

/** `FileSigningService.verify()` steps 2/3: the link has expired, or the signature does not match
 * what `FILE_SIGNING_SECRET` would have produced for this exact `{storageKey, exp}` pair.
 * Deliberately a distinct code (and distinct message) from a generic 404 so a client can tell "this
 * link needs to be re-requested" apart from "this file was never there". */
export class LinkInvalidOrExpiredError extends DomainError {
  constructor() {
    super('LINK_INVALID_OR_EXPIRED', 'This link is invalid or has expired.');
  }
}

/** `FileSigningService.sign()`'s authorization step: the caller asked to sign a `storageKey` that
 * does not belong to their own resolved tenant. Reuses the generic `FORBIDDEN` code (no dedicated
 * code was pre-registered for it), matching legacy's own re-export precedent. */
export class StorageKeyNotOwnedError extends ForbiddenDomainError {}
