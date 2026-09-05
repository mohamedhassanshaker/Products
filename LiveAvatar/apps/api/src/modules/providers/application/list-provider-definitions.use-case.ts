import { Inject, Injectable } from '@nestjs/common';
import type { ProviderCategory } from '../domain/provider';
import { PROVIDER_DEFINITION_REPOSITORY, type ProviderDefinitionRepositoryPort } from '../domain/ports';
import { toProviderDefinitionDto } from './provider-dto';

/** `GET /provider-definitions` (FR-PROVIDER-1). Open to any admin JWT. */
@Injectable()
export class ListProviderDefinitionsUseCase {
  constructor(
    @Inject(PROVIDER_DEFINITION_REPOSITORY) private readonly definitions: ProviderDefinitionRepositoryPort,
  ) {}

  /** @param query - Optional category/enabled filters */
  async execute(query: { category?: ProviderCategory; enabled?: boolean }) {
    const rows = await this.definitions.list(query);
    return { items: rows.map(toProviderDefinitionDto) };
  }
}
