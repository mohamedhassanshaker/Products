import { Type, type Static } from "@sinclair/typebox";

/** LLD §3.3 connector/channel environment vocabulary (distinct from `DeployEnvironment`). */
export const EnvironmentSchema = Type.Union([
  Type.Literal("Sandbox"),
  Type.Literal("Staging"),
  Type.Literal("Production"),
]);
export type EnvironmentValue = Static<typeof EnvironmentSchema>;

/** LLD §3.4 channel type vocabulary (X dropped from scope per the 2026-08-15 user decision). */
export const ChannelTypeSchema = Type.Union([
  Type.Literal("WebWidget"),
  Type.Literal("WhatsApp"),
  Type.Literal("Messenger"),
  Type.Literal("Instagram"),
  Type.Literal("Voice"),
  Type.Literal("Email"),
  Type.Literal("Sms"),
  Type.Literal("Slack"),
  Type.Literal("Teams"),
]);
export type ChannelTypeValue = Static<typeof ChannelTypeSchema>;
