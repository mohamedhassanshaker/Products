import { Type, type Static } from '@sinclair/typebox';

/** `GET /dashboard/summary` query (FR-DASH-1). */
export const DashboardSummaryQuerySchema = Type.Object({
  range: Type.Optional(Type.Union([Type.Literal('1h'), Type.Literal('24h'), Type.Literal('7d')])),
  tenant_id: Type.Optional(Type.String()),
});
/** Inferred dashboard-summary query. */
export type DashboardSummaryQuery = Static<typeof DashboardSummaryQuerySchema>;

/** `GET /dashboard/summary` response (FR-DASH-1). Zero tenants returns zeros, never an error. */
export const DashboardSummaryResponseSchema = Type.Object({
  active_deployments: Type.Integer(),
  sessions: Type.Object({
    started: Type.Integer(),
    ended: Type.Integer(),
    failed: Type.Integer(),
    abandoned: Type.Integer(),
  }),
  error_rate: Type.Number(),
  range: Type.String(),
});
/** Inferred dashboard-summary response. */
export type DashboardSummaryResponse = Static<typeof DashboardSummaryResponseSchema>;

/** Health state for a category cell / one provider row (FR-DASH-2). */
export const ProviderHealthStateSchema = Type.Union([
  Type.Literal('green'),
  Type.Literal('amber'),
  Type.Literal('red'),
  Type.Literal('gray'),
]);

/** One provider's aggregated health row (FR-DASH-2). */
export const ProviderHealthRowSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  state: ProviderHealthStateSchema,
  last_probe_at: Type.Union([Type.String(), Type.Null()]),
});

/** One category's aggregated cell (FR-DASH-2). */
export const ProviderHealthCategorySchema = Type.Object({
  category: Type.String(),
  state: ProviderHealthStateSchema,
  providers: Type.Array(ProviderHealthRowSchema),
});

/** `GET /dashboard/provider-health` response (FR-DASH-2). */
export const ProviderHealthResponseSchema = Type.Object({
  categories: Type.Array(ProviderHealthCategorySchema),
});
/** Inferred provider-health response. */
export type ProviderHealthResponse = Static<typeof ProviderHealthResponseSchema>;
