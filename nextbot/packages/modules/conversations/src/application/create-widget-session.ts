import { resolveTenantBySlug, getTenantBranding } from "@nextbot/tenancy";
import { resolveWidgetChannel, getChannelCapability } from "@nextbot/channels";
import type { CreateWidgetSessionRequest, CreateWidgetSessionResult, WebWidgetConfig } from "@nextbot/contracts";
import { WidgetChannelNotFoundError, SandboxPreviewInvalidError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { issueWidgetSessionToken, verifyWidgetSessionToken } from "./widget-session-token.js";
import { insertConversation, findConversationById } from "../infrastructure/conversation-repository.js";
import { mergeWidgetConfigWithBranding } from "./merge-widget-config.js";

/**
 * Phase 6 (client-feedback-batch item 9) — proof, already independently verified by
 * the caller, that `input.previewVersionId` on a `createWidgetSession` request is
 * genuinely authorized. **This module has no allowed dependency on `@nextbot/iam`**
 * (LLD §2.3's module allow-list: `conversations: ["tenancy", "channels"]`, no `iam`
 * edge) — signature verification of the admin-issued sandbox-preview token happens
 * one layer up, in `apps/gateway`'s composition-root route handler (the only place
 * both `conversations` and `iam` may be imported together), which then passes this
 * already-verified `{ tenantId, versionId }` pair down. `createWidgetSession` itself
 * still re-checks it matches `input.previewVersionId` and the resolved tenant below —
 * defense in depth against a future caller of this function forgetting to gate it,
 * not a substitute for the actual cryptographic verification upstream.
 */
export interface VerifiedSandboxPreview {
  tenantId: string;
  versionId: string;
}

/**
 * FR-OC-01: creates (or resumes) an anonymous widget session. This is the widget's
 * entire "log in" step — there is no Better Auth / admin-identity concept involved,
 * consistent with `widget-session-token.ts`'s doc comment.
 *
 * @param verifiedPreview Only ever set by the composition root after it has
 *   independently verified the caller's Admin Console session/permission for exactly
 *   `input.previewVersionId` — see `VerifiedSandboxPreview`'s doc. Never derived from
 *   `input` itself.
 * @throws {WidgetChannelNotFoundError} unresolvable `tenantSlug` or `channelPublicKey`
 *   (deliberately the same error/message for both — see `resolveWidgetChannel`'s doc).
 * @throws {WidgetChannelInactiveError} the channel exists but is not `Active`.
 * @throws {SandboxPreviewInvalidError} `input.previewVersionId` is present but
 *   `verifiedPreview` is missing, or doesn't match it exactly (wrong tenant or wrong
 *   version) — fails closed, never silently proceeds as an ordinary session.
 */
export async function createWidgetSession(
  input: CreateWidgetSessionRequest,
  verifiedPreview?: VerifiedSandboxPreview,
): Promise<CreateWidgetSessionResult> {
  const tenant = await resolveTenantBySlug(input.tenantSlug);
  if (!tenant) throw new WidgetChannelNotFoundError();

  // Fail-closed sandbox-preview gate (Phase 6): a bare `previewVersionId` with no
  // matching, independently-verified authorization is rejected outright here, before
  // any conversation is created and before the channel's real config/branding is
  // ever resolved — an anonymous caller who merely discovers this query param learns
  // nothing beyond "not authorized."
  if (input.previewVersionId) {
    const authorized =
      verifiedPreview !== undefined &&
      verifiedPreview.tenantId === tenant.id &&
      verifiedPreview.versionId === input.previewVersionId;
    if (!authorized) throw new SandboxPreviewInvalidError();
  }

  // Environment does not gate RLS (only tenantId does, LLD §3.2 rule 4) — a
  // placeholder value is used only for this initial lookup; every subsequent
  // conversation/message operation uses the resolved channel's real environment,
  // *unless* this is an authorized sandbox preview (below), which deliberately
  // scopes the whole session to "Sandbox" regardless of the borrowed channel's own
  // configured environment — this keeps a version-under-test's traffic/quota
  // isolated from that channel's real Production usage.
  const lookupCtx: TenantContext = { tenantId: tenant.id, region: tenant.region, environment: "Production" };
  const channel = await resolveWidgetChannel(lookupCtx, input.channelPublicKey);
  const sessionEnvironment = input.previewVersionId ? "Sandbox" : channel.environment;
  const ctx: TenantContext = { tenantId: tenant.id, region: tenant.region, environment: sessionEnvironment };

  let conversationId: string | undefined;
  let resumeFromSequence = 0;

  // Sandbox-preview sessions never resume a prior conversation, even if a
  // `resumeSessionToken` was somehow supplied alongside the override — every "Test in
  // Sandbox" mount (and every "reload session" click) is a deliberate fresh
  // conversation against the version under test, never a continuation of an earlier
  // test run.
  if (input.resumeSessionToken && !input.previewVersionId) {
    conversationId = await tryResumeConversation(ctx, tenant.id, channel.id, input.resumeSessionToken);
    if (conversationId) {
      const existing = await findConversationById(ctx, conversationId);
      resumeFromSequence = existing ? existing.nextSequence - 1 : 0;
    }
  }

  const language = normalizeLanguage(input.language, tenant.defaultLanguage);

  if (!conversationId) {
    conversationId = await insertConversation(ctx, {
      channelId: channel.id,
      language,
      metadata: input.metadata ?? null,
      // Phase 6/7 seam: `conversation.agent_definition_version_id` already exists in
      // the schema (deferred since Phase 10, BL-07) — a sandbox-preview conversation
      // is the first real writer of it, recording exactly which version this test
      // conversation is for. Phase 7's `recordSandboxTest(ctx, versionId)` hook reads
      // this same id off a completed sandbox turn.
      agentDefinitionVersionId: input.previewVersionId,
    });
  }

  const sessionToken = await issueWidgetSessionToken({
    tenantId: tenant.id,
    region: tenant.region,
    environment: sessionEnvironment,
    channelId: channel.id,
    conversationId,
    previewVersionId: input.previewVersionId,
  });

  const capability = await getChannelCapability(ctx, "WebWidget");
  const branding = await getTenantBranding(tenant.id);
  const config = mergeWidgetConfigWithBranding(
    (channel.config as WebWidgetConfig) ?? {},
    branding?.brandingConfig ?? null,
  );

  return {
    sessionToken,
    conversationId,
    channel: {
      capabilities: capability ?? DEFAULT_WEB_WIDGET_CAPABILITY,
      config,
      languages: [language],
      hidePoweredBy: branding?.whiteLabelEnabled ?? false,
    },
    resumeFromSequence,
  };
}

/** Attempts to resume an existing conversation from a prior session token — a failed
 * or mismatched resume attempt silently falls through to starting a new conversation
 * rather than failing the whole session request (a stale/expired token on page
 * reload must never break the widget). */
async function tryResumeConversation(
  ctx: TenantContext,
  tenantId: string,
  channelId: string,
  resumeSessionToken: string,
): Promise<string | undefined> {
  try {
    const priorClaims = await verifyWidgetSessionToken(resumeSessionToken);
    if (priorClaims.tenantId !== tenantId || priorClaims.channelId !== channelId) return undefined;
    const existing = await findConversationById(ctx, priorClaims.conversationId);
    return existing && existing.status === "Active" ? existing.id : undefined;
  } catch {
    return undefined;
  }
}

/** LLD §5.3: `"auto"`/absent falls back to the tenant's configured default language
 * (FR-OC-07) without blocking interaction while asking. */
function normalizeLanguage(requested: string | undefined, tenantDefault: string): string {
  if (!requested || requested === "auto") return tenantDefault;
  return requested;
}

/** Fallback capability row if `channel_capability`'s WebWidget seed row is ever
 * missing (should not happen once migrations run — defense in depth only). */
const DEFAULT_WEB_WIDGET_CAPABILITY = {
  channelType: "WebWidget" as const,
  supportsRichCards: true,
  supportsQuickReplies: true,
  supportsLists: true,
  supportsForms: true,
  supportsFileUpload: true,
  supportsMarkdown: true,
  supportsTypingIndicator: true,
  maxQuickReplies: null,
  maxButtonLabelChars: null,
  maxTextChars: null,
  formStrategy: "Native" as const,
  listStrategy: "Native" as const,
};
