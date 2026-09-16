/**
 * Begin a step-up challenge — `POST /api/public/v1/conversations/{id}/
 * verification/challenges` (api.md §4.2). A thin, deliberate passthrough to
 * `VerificationProvider.challenge()` (ADR-0006's citizen-verification port,
 * `iam/ports/verification-provider.ts`): this is **the shared path** every
 * caller must use, the same reasoning `tools/application/bind-tool.ts`
 * documents for its own passthrough — the port owns the real behaviour
 * (challenge kind selection, redirect URL shaping), and a second
 * implementation here would just be a second place that could drift from it.
 */

import type {
  VerificationChallenge,
  VerificationProvider,
  VerificationRequest,
} from "../../iam/ports/verification-provider.js";

export interface BeginVerificationDeps {
  readonly provider: VerificationProvider;
}

export class BeginVerification {
  constructor(private readonly deps: BeginVerificationDeps) {}

  async execute(request: VerificationRequest): Promise<VerificationChallenge> {
    return this.deps.provider.challenge(request);
  }
}
