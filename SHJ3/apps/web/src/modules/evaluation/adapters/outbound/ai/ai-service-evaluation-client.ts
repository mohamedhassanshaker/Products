/**
 * The real `AiEvaluationClient` — calls `apps/ai`'s `/v1/evaluation/turns` and
 * `/v1/evaluation/score-similarity`, modelled on `modules/knowledge/adapters/outbound/ai/
 * ai-service-knowledge-client.ts`'s exact convention (`createTenantScopedAiClient()`,
 * trust the JSON response body, let `AiServiceError` propagate to the application layer
 * untranslated — api.md §2.2's boundary-trust rule, matched here rather than
 * re-implementing a second runtime-validation layer this adapter would be the only
 * caller of).
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  AiEvaluationClient,
  EvaluationTurnResult,
  ExecuteEvaluationTurnInput,
} from "../../../ports/ai-evaluation-client.js";

interface TurnResponse {
  readonly status: string;
  readonly messageText: string;
  readonly wasRefused: boolean;
  readonly groundingConfidence: number | null;
  readonly toolCalls: readonly { readonly toolBindingId: string | null; readonly status: string }[];
}

interface SimilarityResponse {
  readonly similarity: number;
}

export class AiServiceEvaluationClient implements AiEvaluationClient {
  async executeTurn(input: ExecuteEvaluationTurnInput): Promise<EvaluationTurnResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<TurnResponse>("/evaluation/turns", {
      conversationId: input.conversationId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      prompt: input.prompt,
      locale: input.locale,
      turnOrdinal: input.turnOrdinal,
    });
    return {
      status: response.status,
      messageText: response.messageText,
      wasRefused: response.wasRefused,
      groundingConfidence: response.groundingConfidence,
      toolCalls: response.toolCalls,
    };
  }

  async scoreSimilarity(actual: string, expected: string): Promise<number> {
    const client = createTenantScopedAiClient();
    const response = await client.post<SimilarityResponse>("/evaluation/score-similarity", {
      actual,
      expected,
    });
    return response.similarity;
  }
}
