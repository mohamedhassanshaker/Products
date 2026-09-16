/**
 * Edit a draft version's scalar configuration — B3 wizard steps 2 ("Instructions": system
 * prompt, tone) and 3 ("Model": primary/fallback model, temperature).
 *
 * Straight passthrough to `AgentRepository.updateVersionConfig`, matching `EditAgent`'s
 * identical thin-wrapper shape. No use case wrapped this repository method before this wave
 * (`agents-tools-api-reference.md`'s own research flagged the gap directly): every other
 * repository method already has one, and calling a port method straight from route code
 * would be the one asymmetric exception in an otherwise consistent module — added here
 * rather than left as a one-off Server Action shortcut.
 *
 * `TR_AgentVersions_publishedImmutable` (SQL trigger, error 51110) rejects this at the
 * database layer if the target version is already `Published` — surfaced here as the same
 * `{ok:false, reason:"immutable", message}` shape `AgentRepository.updateVersionConfig`
 * already returns, not re-wrapped into something new.
 */

import type { AgentRepository, UpdateVersionConfigResult } from "../ports/agent-repository.js";
import type { Tone } from "../domain/agent.js";

export interface UpdateAgentVersionConfigInput {
  readonly agentVersionId: string;
  readonly systemPrompt?: string;
  readonly tone?: Tone;
  readonly primaryModel?: string;
  readonly fallbackModel?: string | null;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly now: Date;
}

export interface UpdateAgentVersionConfigDeps {
  readonly agents: AgentRepository;
}

export class UpdateAgentVersionConfig {
  constructor(private readonly deps: UpdateAgentVersionConfigDeps) {}

  async execute(input: UpdateAgentVersionConfigInput): Promise<UpdateVersionConfigResult> {
    return this.deps.agents.updateVersionConfig(input);
  }
}
