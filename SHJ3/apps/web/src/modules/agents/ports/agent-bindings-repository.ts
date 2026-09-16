/**
 * The four per-version binding tables B3 steps 5/6/8 (and the implicit locale binding)
 * write — `AgentKnowledgeBinding`, `AgentFlowBinding`, `AgentChannelBinding`,
 * `AgentLocaleBinding`. Deliberately one port, not four: all four share an identical
 * "replace the whole set for this version" shape (`docs/api.md` §6.3: "Body is the full
 * set... so the toggles cannot drift"), so four near-identical single-method ports would
 * be four files repeating the same three lines of documentation. Grouped the same way this
 * codebase already accepts "a small, deliberate duplication... rather than a forced shared
 * abstraction" in the other direction (`PrismaRoleRepository`'s own doc comment) — here the
 * concern is the opposite one: avoiding needless proliferation of genuinely homogeneous,
 * low-complexity CRUD.
 */

import type { ChannelKey } from "../domain/agent.js";

export interface KnowledgeBindingRow {
  readonly knowledgeCollectionId: string;
  readonly isEnabled: boolean;
}

export interface FlowBindingRow {
  readonly flowId: string;
  readonly flowVersionId: string;
  readonly isEnabled: boolean;
  readonly ordinal: number;
}

export interface ChannelBindingRow {
  readonly channelKey: ChannelKey;
  readonly isEnabled: boolean;
}

export interface LocaleBindingRow {
  readonly localeCode: string;
  readonly isPrimary: boolean;
}

export interface AgentBindingsRepository {
  listKnowledgeBindings(agentVersionId: string): Promise<readonly KnowledgeBindingRow[]>;
  /** Replaces the whole set for this version — existing rows not present in `bindings` are removed. */
  replaceKnowledgeBindings(
    agentVersionId: string,
    bindings: readonly KnowledgeBindingRow[],
    boundByStaffUserId: string,
    now: Date,
  ): Promise<void>;

  listFlowBindings(agentVersionId: string): Promise<readonly FlowBindingRow[]>;
  replaceFlowBindings(
    agentVersionId: string,
    bindings: readonly FlowBindingRow[],
    now: Date,
  ): Promise<void>;

  listChannelBindings(agentVersionId: string): Promise<readonly ChannelBindingRow[]>;
  replaceChannelBindings(
    agentVersionId: string,
    bindings: readonly ChannelBindingRow[],
    now: Date,
  ): Promise<void>;

  listLocaleBindings(agentVersionId: string): Promise<readonly LocaleBindingRow[]>;
  replaceLocaleBindings(
    agentVersionId: string,
    bindings: readonly LocaleBindingRow[],
    now: Date,
  ): Promise<void>;
}
