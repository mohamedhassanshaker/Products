import type { DataSource, Repository } from 'typeorm';
import { UserEntity } from '@/server/infrastructure/database';
// Cross-module barrel import (not a deep internal import — `FileCleanupRepository` is `reliability`'s
// own public API) — mirrors legacy's `ProfileRepository` importing `FileCleanupQueueEntity` from
// `modules/reliability` directly, adapted here to go through the barrel since this app's module-
// boundary rule (unlike legacy's Nest module system) is enforced by ESLint against internal paths,
// not against importing another module's own public surface.
import { FileCleanupRepository } from '@/server/reliability';

/** Fields FR-IAM-4 allows a user to edit about themselves via `PATCH /api/profile`. */
export type ProfileUpdateFields = Partial<
  Pick<UserEntity, 'firstName' | 'lastName' | 'phone' | 'occupation' | 'companyName' | 'country' | 'educationLevelId'>
>;

/**
 * Thin data access over the tenant-scoped `user` table, scoped to the `profile` module's own needs
 * (FR-IAM-4: view/update profile fields, set the avatar storage key) — ported logic from
 * `legacy/api/src/modules/profile/infrastructure/repositories/profile.repository.ts`, adapted to
 * this app's DataSource-constructor convention.
 */
export class ProfileRepository {
  private readonly repo: Repository<UserEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository<UserEntity>('user');
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Applies a partial update of the FR-IAM-4 editable fields. Only defined keys in `fields` are
   * written — `undefined` values are omitted by the caller (`ProfileService`) before this is called,
   * so an unset field is never accidentally nulled out. */
  async updateFields(id: string, fields: ProfileUpdateFields): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await this.repo.update({ id }, fields);
  }

  /**
   * Sets the avatar storage key. If a previous key existed, it is scheduled for later deletion
   * (FR-IAM-4: "schedules the previous file for cleanup rather than deleting it inline") via
   * `reliability`'s `FileCleanupRepository` — both the `user.pic` update and the
   * `file_cleanup_queue` insert happen in one transaction, so a crash between them can never leave a
   * stale key scheduled for deletion while the user row still points at it (or vice versa). No
   * draining worker consumes this queue yet this dispatch (see `server/reliability`'s own doc
   * comment) — the row is scheduled correctly and durably regardless.
   */
  async setPicture(id: string, storageKey: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const userRepo = tx.getRepository<UserEntity>('user');
      const current = await userRepo.findOne({ where: { id } });
      await userRepo.update({ id }, { pic: storageKey });
      if (current?.pic && current.pic !== storageKey) {
        await new FileCleanupRepository(this.dataSource).schedule(current.pic, tx);
      }
    });
  }
}
