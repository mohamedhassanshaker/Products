/**
 * Save B6 tab 3's retrieval configuration form (FR-KNOW-11/12/13).
 *
 * Client-side-mirrored validation is re-checked here too (never trust the client alone):
 * `CK_RetrievalConfigs_weightsSumToOne`/`_overlapLessThanSize`/`_topK`'s exact application-
 * layer mirrors from `domain/retrieval-config.ts`, so a bad submit fails with a named
 * reason instead of a raw database constraint error.
 *
 * **Why this use case never inserts a `ReindexJob` itself when the embedding model
 * changes**, even though it can trivially detect that change
 * (`embeddingModelChanged`): `TR_RetrievalConfigs_modelChangeQueuesReindex` already does
 * this, at the database, on the very `UPDATE` statement `RetrievalConfigRepository.
 * updateTenantConfig` issues (`ReindexJobs`' own doc comment). Inserting a second job here
 * would either violate `UQ_ReindexJobs_activeTenantScope` in production (a real unique
 * index rejecting the duplicate) or, if the trigger raced behind this insert, leave two
 * jobs where FR-KNOW-13 promises exactly one. So this use case's job is narrower and
 * honest: report whether the model identity changed, so the Server Action can re-fetch the
 * job list and show the operator the row the trigger already created — never to create that
 * row itself.
 */

import {
  embeddingModelChanged,
  overlapIsValid,
  topKIsValid,
  weightsSumToOne,
} from "../domain/retrieval-config.js";
import type {
  RetrievalConfigRepository,
  RetrievalConfigRow,
  UpdateRetrievalConfigInput as RepositoryUpdateInput,
} from "../ports/retrieval-config-repository.js";

export type UpdateRetrievalConfigInput = RepositoryUpdateInput;

export type UpdateRetrievalConfigResult =
  | { readonly ok: true; readonly config: RetrievalConfigRow; readonly modelChanged: boolean }
  | { readonly ok: false; readonly reason: "knowledge.weights_must_sum_to_one" }
  | { readonly ok: false; readonly reason: "knowledge.overlap_must_be_less_than_chunk_size" }
  | { readonly ok: false; readonly reason: "knowledge.top_k_out_of_range" };

export interface UpdateRetrievalConfigDeps {
  readonly retrievalConfig: RetrievalConfigRepository;
}

export class UpdateRetrievalConfig {
  constructor(private readonly deps: UpdateRetrievalConfigDeps) {}

  async execute(input: UpdateRetrievalConfigInput): Promise<UpdateRetrievalConfigResult> {
    if (!weightsSumToOne(input.graphWeight, input.vectorWeight)) {
      return { ok: false, reason: "knowledge.weights_must_sum_to_one" };
    }
    if (!overlapIsValid(input.chunkSizeTokens, input.chunkOverlapTokens)) {
      return { ok: false, reason: "knowledge.overlap_must_be_less_than_chunk_size" };
    }
    if (!topKIsValid(input.topK)) {
      return { ok: false, reason: "knowledge.top_k_out_of_range" };
    }

    const before = await this.deps.retrievalConfig.ensureTenantConfig(input.now);
    const after = await this.deps.retrievalConfig.updateTenantConfig(input);
    return { ok: true, config: after, modelChanged: embeddingModelChanged(before, after) };
  }
}
