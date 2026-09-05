import { randomUUID } from 'node:crypto';
import { requireTenantId } from '@/server/context';
import { InternalDomainError, NotFoundDomainError } from '@/server/common/errors/domain-error';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { extensionForImageType, sniffImageMimeType } from '@/server/common/util/image-signature.util';
import { FileTooLargeError, UnsupportedImageTypeError } from '../domain/errors';
import type { ProfileSummary } from '../domain/profile.types';
import { ProfileRepository, type ProfileUpdateFields } from '../infrastructure/profile.repository';
import type { UserEntity } from '@/server/infrastructure/database';

export interface ProfileServiceConfig {
  maxAvatarSizeBytes: number;
}

/**
 * FR-IAM-4's business logic — ported logic (not code) from
 * `legacy/api/src/modules/profile/application/profile.service.ts`'s `ProfileService`, adapted to this
 * app's plain-class composition convention (no NestJS DI).
 */
export class ProfileService {
  constructor(
    private readonly config: ProfileServiceConfig,
    private readonly profiles: ProfileRepository,
    private readonly storage: StoragePort,
  ) {}

  /** @throws {NotFoundDomainError} if `userId` no longer exists. */
  async getProfile(userId: string): Promise<ProfileSummary> {
    const user = await this.requireUser(userId);
    return toSummary(user);
  }

  /** Applies a partial update of the FR-IAM-4 editable fields. Server-side validation (length/type)
   * is the Route Handler's job (`server/common/http/validate.ts`); this method only decides *which*
   * provided fields to write (skipping `undefined` ones, so an omitted field is never accidentally
   * cleared) and re-reads the row to return a fully up-to-date summary. */
  async updateProfile(
    userId: string,
    fields: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      occupation?: string;
      companyName?: string;
      country?: string;
      educationLevelId?: number;
    },
  ): Promise<ProfileSummary> {
    await this.requireUser(userId); // 404s before attempting a write against a vanished user.

    const update: ProfileUpdateFields = {};
    if (fields.firstName !== undefined) update.firstName = fields.firstName.trim();
    if (fields.lastName !== undefined) update.lastName = fields.lastName.trim();
    if (fields.phone !== undefined) update.phone = fields.phone.trim() || null;
    if (fields.occupation !== undefined) update.occupation = fields.occupation.trim() || null;
    if (fields.companyName !== undefined) update.companyName = fields.companyName.trim() || null;
    if (fields.country !== undefined) update.country = fields.country.trim() || null;
    if (fields.educationLevelId !== undefined) update.educationLevelId = fields.educationLevelId;

    await this.profiles.updateFields(userId, update);
    const updated = await this.requireUser(userId);
    return toSummary(updated);
  }

  /**
   * FR-IAM-4's avatar upload. Validates the file's real content (magic bytes, never the
   * client-declared `Content-Type`) and size, writes it via `StoragePort` under a server-generated
   * key (never derived from the client's original filename), then records the key on the user row.
   *
   * @throws {FileTooLargeError} if `buffer.length` exceeds `MAX_AVATAR_SIZE_BYTES` — this app's
   *   *only* size enforcement point (see this module's `domain/errors.ts` doc comment for the
   *   documented gap vs. legacy's two-layer, multer-fronted defense).
   * @throws {UnsupportedImageTypeError} if the buffer's magic bytes are not JPEG/PNG/WebP.
   */
  async uploadPicture(userId: string, file: { buffer: Buffer; size: number }): Promise<ProfileSummary> {
    await this.requireUser(userId);

    const maxBytes = this.config.maxAvatarSizeBytes;
    if (file.size > maxBytes) {
      throw new FileTooLargeError(maxBytes);
    }

    const sniffed = sniffImageMimeType(file.buffer);
    if (!sniffed) {
      throw new UnsupportedImageTypeError();
    }

    const tenantId = requireTenantIdOrInternal();

    const ext = extensionForImageType(sniffed);
    const key = `tenants/${tenantId}/avatars/${userId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, sniffed);

    // The previous key (if any) is scheduled for cleanup, not deleted inline — see
    // `ProfileRepository.setPicture`'s own doc comment.
    await this.profiles.setPicture(userId, key);

    const updated = await this.requireUser(userId);
    return toSummary(updated);
  }

  private async requireUser(userId: string): Promise<UserEntity> {
    const user = await this.profiles.findById(userId);
    if (!user) {
      throw new NotFoundDomainError('User not found.');
    }
    return user;
  }
}

/** Thin wrapper translating `requireTenantId()`'s own `InternalDomainError` message into this
 * method's specific caller name, matching legacy's identical defensive-assertion framing (this route
 * only ever runs behind `withTenantContext`, so a missing tenant id here is a programmer error). */
function requireTenantIdOrInternal(): string {
  try {
    return requireTenantId();
  } catch {
    throw new InternalDomainError(new Error('uploadPicture() called outside any resolved tenant scope.'));
  }
}

function toSummary(user: UserEntity): ProfileSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    occupation: user.occupation,
    companyName: user.companyName,
    country: user.country,
    educationLevelId: user.educationLevelId,
    pictureKey: user.pic,
  };
}
