import { Type, type Static } from '@sinclair/typebox';

/**
 * `POST /public/sessions` request (FR-AUTH-4). No admin JWT — end users have
 * no accounts. Exactly one of `slug`/`tenant_id` is expected; the use case
 * (not this schema) enforces that and treats "neither present" the same as
 * an unknown tenant (`404 TENANT_NOT_FOUND`).
 */
export const PublicSessionCreateRequestSchema = Type.Object({
  slug: Type.Optional(Type.String({ minLength: 1, maxLength: 48 })),
  tenant_id: Type.Optional(Type.String({ format: 'uuid' })),
  display_name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  // Opaque per-browser-tab correlation key (FR-AUTH-4 idempotency). Not a
  // secret — just enough entropy that two different tabs don't collide.
  tab_key: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

/** Inferred create-session request. */
export type PublicSessionCreateRequest = Static<typeof PublicSessionCreateRequestSchema>;

/** `POST /public/sessions` response — the LiveKit room token the browser joins with. */
export const PublicSessionResponseSchema = Type.Object({
  session_id: Type.String({ format: 'uuid' }),
  room_name: Type.String(),
  ws_url: Type.String(),
  token: Type.String(),
  expires_at: Type.String(),
});

/** Inferred session-issue response. */
export type PublicSessionResponse = Static<typeof PublicSessionResponseSchema>;

/** `GET /public/deployments/{slug}/preflight` response (FR-CALL-1). */
export const PreflightResponseSchema = Type.Object({
  deployment: Type.Object({
    slug: Type.String(),
    name: Type.String(),
  }),
  transport: Type.Object({
    reachable: Type.Boolean(),
    ws_url: Type.String(),
  }),
  config: Type.Object({
    complete: Type.Boolean(),
  }),
  avatar: Type.Object({
    // No v1 avatar adapter is built until Phase 5/6, so this is always
    // absent today; the client falls back to the platform placeholder image
    // exactly as FR-CALL-1 specifies for "no preview_url supplied".
    preview_url: Type.Optional(Type.String()),
  }),
});

/** Inferred preflight response. */
export type PreflightResponse = Static<typeof PreflightResponseSchema>;

/** `POST /public/sessions/{id}/end` request body — the LiveKit user token, used as the auth proof. */
export const PublicSessionEndRequestSchema = Type.Object({
  token: Type.String({ minLength: 1 }),
});

/** Inferred end-session request. */
export type PublicSessionEndRequest = Static<typeof PublicSessionEndRequestSchema>;

/**
 * `POST /public/sessions/{id}/end` response. `summary_token`/
 * `summary_token_expires_at` are only present the first time a given session
 * transitions to `ended` (Screen 11 / BL-025 is a later phase; a duplicate
 * end-call is still idempotent at the status level per FR-TRANSPORT-4, it
 * just cannot re-hand out a token this endpoint never stored in reversible
 * form).
 */
export const PublicSessionEndResponseSchema = Type.Object({
  status: Type.Literal('ended'),
  summary_token: Type.Optional(Type.String()),
  summary_token_expires_at: Type.Optional(Type.String()),
});

/** Inferred end-session response. */
export type PublicSessionEndResponse = Static<typeof PublicSessionEndResponseSchema>;

/**
 * `GET /public/sessions/{id}/summary` response (FR-CALL-4, Screen 11).
 * `transcript` is only ever present when the session's transcript has not
 * been purged (a purged session 410s before reaching this shape at all —
 * see `GetSessionSummaryUseCase`).
 */
export const PublicSessionSummarySchema = Type.Object({
  status: Type.String(),
  summary_text: Type.Optional(Type.String()),
  summary_status: Type.Union([
    Type.Literal('none'),
    Type.Literal('pending'),
    Type.Literal('ready'),
    Type.Literal('unavailable'),
  ]),
  transcript: Type.Optional(
    Type.Array(Type.Object({ role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]), text: Type.Union([Type.String(), Type.Null()]) })),
  ),
  feedback_submitted: Type.Boolean(),
});

/** Inferred post-call summary response. */
export type PublicSessionSummary = Static<typeof PublicSessionSummarySchema>;

/** `POST /public/sessions/{id}/feedback` request (FR-CALL-4). */
export const PublicFeedbackRequestSchema = Type.Object({
  rating: Type.Integer({ minimum: 1, maximum: 5 }),
  comment: Type.Optional(Type.String({ maxLength: 1000 })),
});

/** Inferred feedback request. */
export type PublicFeedbackRequest = Static<typeof PublicFeedbackRequestSchema>;
