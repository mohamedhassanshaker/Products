import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `profile`-module `DomainError` subclasses — ported verbatim from
 * `legacy/api/src/modules/profile/domain/errors.ts`.
 */

/** FR-IAM-4: the uploaded file's sniffed magic bytes are not one of JPEG/PNG/WebP. Deliberately
 * based on the file's real content, never the client-supplied `Content-Type`. */
export class UnsupportedImageTypeError extends DomainError {
  constructor() {
    super('UNSUPPORTED_IMAGE_TYPE', 'Profile pictures must be a JPEG, PNG, or WebP image.');
  }
}

/** FR-IAM-4: the uploaded file exceeds `MAX_AVATAR_SIZE_BYTES` (default 5MB). This app has no
 * `multer`-equivalent request-body size limiter ahead of `request.formData()` (see
 * `docs/plans/nextjs-rewrite-phase1-plan.md`'s Sub-slice 1c "Decisions made" for the documented
 * gap), so this check inside `ProfileService.uploadPicture` is this app's *only* enforcement point,
 * not defense-in-depth behind a framework-level cap the way legacy's identical check was. */
export class FileTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super('FILE_TOO_LARGE', `The uploaded file exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}
