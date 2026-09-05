import { Type as T } from '@sinclair/typebox';

/**
 * Provider/runtime catalog literal unions (LLD §6.1), split out of
 * `schema.ts` so `reasoning-graph.schema.ts` can import `LlmProviderKey`
 * without a circular import back into `schema.ts` (which itself imports
 * `ReasoningSchema` from `reasoning-graph.schema.ts`). Re-exported from
 * `schema.ts` unchanged so no existing import site needs to change.
 */

/** v1 supports only LiveKit as transport (FR-PROVIDER-5). */
export const TransportProviderKey = T.Literal('livekit');
/** Speech-to-text catalog keys (FR-PROVIDER-1). */
export const SttProviderKey = T.Union([T.Literal('deepgram'), T.Literal('faster-whisper')]);
/** LLM catalog keys (FR-PROVIDER-1). */
export const LlmProviderKey = T.Union([T.Literal('openai'), T.Literal('anthropic'), T.Literal('google')]);
/** Text-to-speech catalog keys (FR-PROVIDER-1). */
export const TtsProviderKey = T.Union([T.Literal('fish-speech'), T.Literal('elevenlabs')]);
/** Avatar catalog keys (FR-PROVIDER-1) — includes Alibaba LiveAvatar (Example B). */
export const AvatarProviderKey = T.Union([T.Literal('bithuman'), T.Literal('alibaba-liveavatar')]);
/** Agent orchestration runtime (FR-AGENT-*). */
export const AgentRuntimeKey = T.Union([T.Literal('langgraph'), T.Literal('pydantic-ai')]);
/** Data-residency mode (FR-PRIV-*). */
export const ResidencyMode = T.Union([
  T.Literal('prompt_text_only'),
  T.Literal('prompt_and_transcript'),
  T.Literal('none'),
]);
