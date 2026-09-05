import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { PROVIDER_DEFINITION_REPOSITORY, type ProviderDefinitionRepositoryPort } from '../domain/ports';
import { toProviderDefinitionDto } from './provider-dto';

/**
 * `PATCH /provider-definitions/:key` — operator only (FR-PROVIDER-1).
 * Disabling the last enabled entry in a category is blocked so Agent Builder
 * always has at least one option per layer.
 */
@Injectable()
export class SetProviderDefinitionEnabledUseCase {
  constructor(
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
  ) {}

  /**
   * @param key - Catalog key
   * @param enabled - Target enabled state
   */
  async execute(key: string, enabled: boolean) {
    const existing = await this.definitions.findByKey(key);
    if (!existing) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }
    if (!enabled && existing.enabled) {
      const enabledCount = await this.definitions.countEnabledInCategory(existing.category);
      if (enabledCount <= 1) {
        throw new AppError('PROVIDER_CATEGORY_EMPTY', 422);
      }
    }
    const updated = await this.definitions.setEnabled(key, enabled);
    if (!updated) {
      throw AppError.notFound('PROVIDER_UNKNOWN');
    }
    return toProviderDefinitionDto(updated);
  }
}
