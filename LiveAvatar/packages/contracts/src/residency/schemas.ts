import { Type, type Static } from '@sinclair/typebox';

/** `GET /tenants/{id}/residency` response (FR-PRIV-1). */
export const ResidencyResponseSchema = Type.Object({
  send_to_remote_llm: Type.Union([
    Type.Literal('prompt_text_only'),
    Type.Literal('prompt_and_transcript'),
    Type.Literal('none'),
  ]),
  retain_transcripts_days: Type.Integer({ minimum: 1, maximum: 730 }),
  recordings_enabled: Type.Boolean(),
  updated_at: Type.String(),
});
/** Inferred residency response. */
export type ResidencyResponse = Static<typeof ResidencyResponseSchema>;

/** `PUT /tenants/{id}/residency` request (FR-PRIV-1). */
export const UpdateResidencyRequestSchema = Type.Object({
  send_to_remote_llm: Type.Union([
    Type.Literal('prompt_text_only'),
    Type.Literal('prompt_and_transcript'),
    Type.Literal('none'),
  ]),
  retain_transcripts_days: Type.Integer({ minimum: 1, maximum: 730 }),
  recordings_enabled: Type.Boolean(),
});
/** Inferred update-residency request. */
export type UpdateResidencyRequest = Static<typeof UpdateResidencyRequestSchema>;

/** `PUT /tenants/{id}/residency` response — `warnings` is empty unless recording capture applies. */
export const UpdateResidencyResponseSchema = Type.Object({
  send_to_remote_llm: ResidencyResponseSchema.properties.send_to_remote_llm,
  retain_transcripts_days: Type.Integer(),
  recordings_enabled: Type.Boolean(),
  updated_at: Type.String(),
  warnings: Type.Array(Type.String()),
});
/** Inferred update-residency response. */
export type UpdateResidencyResponse = Static<typeof UpdateResidencyResponseSchema>;
