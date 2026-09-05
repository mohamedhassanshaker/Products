import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";
import { EnvironmentSchema, ChannelTypeSchema } from "./common.js";

/** LLD §3.4 — a channel is exactly one of these three statuses. */
export const ChannelStatusSchema = Type.Union([
  Type.Literal("Active"),
  Type.Literal("Inactive"),
  Type.Literal("Error"),
]);
export type ChannelStatusValue = Static<typeof ChannelStatusSchema>;

/**
 * LLD §3.4 `WebWidgetConfig` — the FR-OC-01 host config, mirrored 1:1 by the
 * `NextBot.init({...})` embed object documented in the screen inventory's §A.3.1.
 * `allowedOrigins` is a small addition beyond the LLD's literal field list (a locally
 * reversible decision, LLD §3 nexus-dev rule): LLD §5.1's surface map requires "strict
 * CORS by channel `allowedOrigins`" but the field never appears in the `channel.config`
 * shape it also cites — this schema is the natural place for it to live, since it is
 * per-channel host-config data. Defaults to `["*"]` (open) when omitted, since no
 * channel-management wizard exists yet to collect a real allowlist from an admin;
 * flagged as a hardening item for whichever phase builds full FR-OC-02/03.
 */
export const WebWidgetThemeSchema = Type.Object({
  primaryColor: Type.Optional(Type.String()),
  fontFamily: Type.Optional(Type.String()),
  launcherIcon: Type.Optional(Type.String({ format: "uri" })),
  headerTitle: Type.Optional(Type.String()),
  headerTitleAr: Type.Optional(Type.String()),
});
export type WebWidgetTheme = Static<typeof WebWidgetThemeSchema>;

export const WidgetQuickActionSchema = Type.Object({
  label: Type.String(),
  labelAr: Type.Optional(Type.String()),
  request: Type.String(),
});

export const WidgetMenuItemSchema = Type.Recursive((This) =>
  Type.Object({
    label: Type.String(),
    request: Type.Optional(Type.String()),
    children: Type.Optional(Type.Array(This)),
  }),
);

export const WebWidgetConfigSchema = Type.Object({
  position: Type.Optional(
    Type.Union([
      Type.Literal("bottom-right"),
      Type.Literal("bottom-left"),
      Type.Literal("top-right"),
      Type.Literal("top-left"),
    ]),
  ),
  language: Type.Optional(Type.String()), // "auto" | BCP-47 code
  direction: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("ltr"), Type.Literal("rtl")]),
  ),
  theme: Type.Optional(WebWidgetThemeSchema),
  quickActions: Type.Optional(Type.Array(WidgetQuickActionSchema)),
  menu: Type.Optional(
    Type.Object({
      enabled: Type.Boolean(),
      defaultMode: Type.Union([Type.Literal("chat"), Type.Literal("menu")]),
      items: Type.Array(WidgetMenuItemSchema),
    }),
  ),
  proactiveNudge: Type.Optional(
    Type.Object({
      enabled: Type.Boolean(),
      delaySeconds: Type.Number(),
      message: Type.String(),
      messageAr: Type.Optional(Type.String()),
    }),
  ),
  allowedOrigins: Type.Optional(Type.Array(Type.String())),
});
export type WebWidgetConfig = Static<typeof WebWidgetConfigSchema>;

/**
 * LLD §3.4 `channel_capability` — static, non-tenant-scoped reference data driving
 * FR-OC-06's automatic rendering fallback.
 */
export const ChannelCapabilitySchema = Type.Object({
  channelType: ChannelTypeSchema,
  supportsRichCards: Type.Boolean(),
  supportsQuickReplies: Type.Boolean(),
  supportsLists: Type.Boolean(),
  supportsForms: Type.Boolean(),
  supportsFileUpload: Type.Boolean(),
  supportsMarkdown: Type.Boolean(),
  supportsTypingIndicator: Type.Boolean(),
  maxQuickReplies: Type.Union([Type.Integer(), Type.Null()]),
  maxButtonLabelChars: Type.Union([Type.Integer(), Type.Null()]),
  maxTextChars: Type.Union([Type.Integer(), Type.Null()]),
  formStrategy: Type.Union([Type.Literal("Native"), Type.Literal("SequentialPrompt")]),
  listStrategy: Type.Union([Type.Literal("Native"), Type.Literal("NumberedText")]),
});
export type ChannelCapability = Static<typeof ChannelCapabilitySchema>;

/**
 * Minimal channel-creation request. Scoped to `WebWidget` only this phase (BL-04) —
 * the other 8 channel types' setup wizards (FR-OC-03) are a later backlog phase
 * (BL-14/BL-15); this is *not* a re-implementation of FR-OC-02's full channel list,
 * just enough for a tenant to obtain a real embeddable widget channel + public key.
 */
export const CreateWebWidgetChannelRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  environment: EnvironmentSchema,
  config: Type.Optional(WebWidgetConfigSchema),
});
export type CreateWebWidgetChannelRequest = Static<typeof CreateWebWidgetChannelRequestSchema>;

/**
 * BL-15's "Add Channel" type-selection step (FR-OC-03) — only the two types this
 * codebase has a real config flow for this dispatch. Adding Messenger/Instagram
 * later is an additive change to this union, not a breaking one.
 */
export const CreatableChannelTypeSchema = Type.Union([Type.Literal("WebWidget"), Type.Literal("WhatsApp")]);
export type CreatableChannelTypeValue = Static<typeof CreatableChannelTypeSchema>;

export const CreateChannelRequestSchema = Type.Object({
  type: CreatableChannelTypeSchema,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  environment: EnvironmentSchema,
  config: Type.Optional(WebWidgetConfigSchema),
});
export type CreateChannelRequest = Static<typeof CreateChannelRequestSchema>;

export class ChannelNameDuplicateError extends DomainError {
  readonly code = "CHANNEL_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A channel named '${name}' already exists in this environment.`);
  }
}

export class ChannelNotFoundError extends DomainError {
  readonly code = "CHANNEL_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Channel not found.");
  }
}

/** FR-OC-01: unknown/deactivated `channelId` — the widget renders a disabled launcher
 * with a tooltip, never a broken UI. */
export class WidgetChannelNotFoundError extends DomainError {
  readonly code = "WIDGET_CHANNEL_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Chat is temporarily unavailable.");
  }
}

export class WidgetChannelInactiveError extends DomainError {
  readonly code = "WIDGET_CHANNEL_INACTIVE";
  readonly httpStatus = 403;
  constructor() {
    super("Chat is temporarily unavailable.");
  }
}
