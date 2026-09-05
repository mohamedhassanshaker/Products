import { Type, type Static } from '@sinclair/typebox';

/** Provider category (spec FR-PROVIDER-1). */
export const ProviderCategorySchema = Type.Union([
  Type.Literal('transport'),
  Type.Literal('stt'),
  Type.Literal('llm'),
  Type.Literal('tts'),
  Type.Literal('avatar'),
]);

/** Inferred provider category. */
export type ProviderCategory = Static<typeof ProviderCategorySchema>;

/** Where the provider's workload runs (FR-PROVIDER-6 badge). */
export const ProviderHostingSchema = Type.Union([Type.Literal('self_hosted'), Type.Literal('remote')]);

/** Inferred provider hosting. */
export type ProviderHosting = Static<typeof ProviderHostingSchema>;

/** Probe result (FR-PROVIDER-3). */
export const ProbeStatusSchema = Type.Union([
  Type.Literal('healthy'),
  Type.Literal('degraded'),
  Type.Literal('unreachable'),
  Type.Literal('unknown'),
]);

/** Inferred probe status. */
export type ProbeStatus = Static<typeof ProbeStatusSchema>;

/**
 * Built-in catalog entry (Screen 4). `key` is the same literal union used by
 * `agent-config`'s per-layer provider schemas so a dropdown and a YAML value
 * are always the same string.
 */
export const ProviderDefinitionSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 64 }),
  category: ProviderCategorySchema,
  display_name: Type.String({ minLength: 1, maxLength: 80 }),
  hosting: ProviderHostingSchema,
  interface_name: Type.String({ minLength: 1, maxLength: 48 }),
  requires_credential: Type.Boolean(),
  enabled: Type.Boolean(),
  feature_gaps: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

/** Provider catalog entry DTO. */
export type ProviderDefinitionDto = Static<typeof ProviderDefinitionSchema>;

/** `PATCH /provider-definitions/:key` body — operator only (FR-PROVIDER-1). */
export const SetProviderDefinitionEnabledRequestSchema = Type.Object({
  enabled: Type.Boolean(),
});

/** Inferred enable/disable request. */
export type SetProviderDefinitionEnabledRequest = Static<
  typeof SetProviderDefinitionEnabledRequestSchema
>;

/** `GET /provider-definitions` query. */
export const ListProviderDefinitionsQuerySchema = Type.Object({
  category: Type.Optional(ProviderCategorySchema),
  enabled: Type.Optional(Type.Boolean()),
});

/** Inferred catalog list query. */
export type ListProviderDefinitionsQuery = Static<typeof ListProviderDefinitionsQuerySchema>;

/**
 * Secret-shaped keys that must never appear in a credential's `extra` blob or
 * in generated/hand-edited YAML (FR-PROVIDER-2, FR-PROVIDER-7, FR-CONFIG-2).
 * Matched case-insensitively against object keys anywhere in the payload.
 */
export const SECRET_KEY_NAMES = ['api_key', 'apiKey', 'token', 'password', 'secret'] as const;

/**
 * Recursively scans a JSON-like value for any key name in `SECRET_KEY_NAMES`.
 * Used identically by the provider-credential `extra` guard (FR-PROVIDER-2)
 * and the YAML secret guard (FR-PROVIDER-7) so the two never drift.
 * @param value - Parsed JSON value (object, array, or primitive)
 * @returns true when a disallowed key name is found anywhere in the structure
 */
export function containsSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretKey(item));
  }
  if (value !== null && typeof value === 'object') {
    const lowerNames = new Set(SECRET_KEY_NAMES.map((n) => n.toLowerCase()));
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (lowerNames.has(key.toLowerCase())) {
        return true;
      }
      if (containsSecretKey(nested)) {
        return true;
      }
    }
  }
  return false;
}

/** `POST /tenants/:id/provider-credentials` body (FR-PROVIDER-2). */
export const CreateProviderCredentialRequestSchema = Type.Object({
  provider_key: Type.String({ minLength: 1, maxLength: 64 }),
  endpoint_url: Type.String({ minLength: 1, maxLength: 2048 }),
  credential_ref: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  display_label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  extra: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/** Inferred create-credential request. */
export type CreateProviderCredentialRequest = Static<typeof CreateProviderCredentialRequestSchema>;

/** `PATCH /tenants/:id/provider-credentials/:credId` body — same fields, all optional. */
export const UpdateProviderCredentialRequestSchema = Type.Object({
  endpoint_url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  credential_ref: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  display_label: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  extra: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/** Inferred update-credential request. */
export type UpdateProviderCredentialRequest = Static<typeof UpdateProviderCredentialRequestSchema>;

/** `GET /tenants/:id/provider-credentials` query. */
export const ListProviderCredentialsQuerySchema = Type.Object({
  category: Type.Optional(ProviderCategorySchema),
  provider_key: Type.Optional(Type.String({ maxLength: 64 })),
});

/** Inferred list-credentials query. */
export type ListProviderCredentialsQuery = Static<typeof ListProviderCredentialsQuerySchema>;

/** Credential row as returned to the admin UI — never the secret value. */
export const ProviderCredentialSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  provider_key: Type.String(),
  display_label: Type.String(),
  endpoint_url: Type.String(),
  credential_ref: Type.Union([Type.String(), Type.Null()]),
  has_secret: Type.Boolean(),
  extra: Type.Record(Type.String(), Type.Unknown()),
  last_probe_status: ProbeStatusSchema,
  last_probe_at: Type.Union([Type.String(), Type.Null()]),
  last_probe_error: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
});

/** Provider credential DTO. */
export type ProviderCredentialDto = Static<typeof ProviderCredentialSchema>;

/** `POST /tenants/:id/provider-credentials/:credId/probe` response (FR-PROVIDER-3). */
export const ProbeResultSchema = Type.Object({
  status: ProbeStatusSchema,
  error_code: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  probed_at: Type.String(),
});

/** Probe result DTO. */
export type ProbeResultDto = Static<typeof ProbeResultSchema>;
