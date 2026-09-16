/** B13 tab 1's "create a new golden set" affordance. */

import type { GoldenSetKind } from "../domain/vocabulary.js";
import type { GoldenSetRepository, GoldenSetRow } from "../ports/golden-set-repository.js";

export type CreateGoldenSetResult =
  | { readonly ok: true; readonly value: GoldenSetRow }
  | { readonly ok: false; readonly error: "evaluation.language_parity_requires_locale" };

export interface CreateGoldenSetInput {
  readonly name: string;
  readonly ownerTenantId: string;
  readonly description: string | null;
  readonly kind: GoldenSetKind;
  readonly localeCode: string | null;
  readonly now: Date;
}

export class CreateGoldenSet {
  constructor(private readonly deps: { readonly sets: GoldenSetRepository }) {}

  async execute(input: CreateGoldenSetInput): Promise<CreateGoldenSetResult> {
    // `CK_GoldenSets_parityHasLocale` — checked here too (defence in depth, matching this
    // codebase's `PublishAgentVersion`/`canPublish` precedent) so a rejection reads as a
    // clear, typed result rather than a live SQL Server error.
    if (input.kind === "LanguageParity" && input.localeCode === null) {
      return { ok: false, error: "evaluation.language_parity_requires_locale" };
    }
    const row = await this.deps.sets.create({
      name: input.name,
      ownerTenantId: input.ownerTenantId,
      description: input.description,
      kind: input.kind,
      localeCode: input.kind === "LanguageParity" ? input.localeCode : null,
      now: input.now,
    });
    return { ok: true, value: row };
  }
}
