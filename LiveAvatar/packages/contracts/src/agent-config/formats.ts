import { FormatRegistry } from '@sinclair/typebox';

/**
 * Registers the string formats TypeBox's `format: '...'` keyword needs
 * across every schema in this package (`AgentConfigSchema.deployment.tenant_id`,
 * LLD §6.1, plus the `/internal` wire contracts' `date-time`/`uri` usages,
 * LLD §5.9/§6.3). TypeBox treats an unregistered format as an unconditional
 * validation failure (`Value.Check`/`Value.Errors` report `"Unknown format
 * '<name>'"`) rather than ignoring it, so this side-effect import must run
 * before any code calls `Value.Check(...)` against a schema using any of
 * these formats — imported at the top of `schema.ts` (and re-imported by
 * `internal/schemas.ts`) so every consumer gets it for free.
 *
 * `DraftAgentConfigSchema` (apps/api's Nest-only draft mirror) deliberately
 * avoids the `format` keyword on `tenant_id` instead of relying on this
 * registration, since a draft's `tenant_id` is server-owned/overwritten
 * before persistence either way — this file only needs to cover the
 * canonical schema's own `Value.Check` call sites (e.g. the cross-language
 * contract test).
 *
 * NOTE (QA fix, Phase 4 retry): `date-time` and `uri` were added here after
 * `internal/schemas.ts` shipped with `format: 'date-time'`/`format: 'uri'`
 * usages but no matching registration — every request to
 * `POST /internal/sessions/{id}/events` and `.../utterances` was rejected
 * with 400 regardless of payload validity until this fix. Any new `format`
 * keyword added anywhere in this package MUST be registered here in the same
 * change, or it will silently fail every `Value.Check` call site that uses it.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 3339 date-time validator. Deliberately permissive on sub-second
 * precision/fractional digits (any length) and requires an explicit `Z` or
 * `+HH:MM`/`-HH:MM` offset, matching `Date.prototype.toISOString()`'s output
 * (the shape every caller of `SessionEventRequestSchema.at` and
 * `UtteranceItemSchema.started_at`/`ended_at` actually sends).
 */
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (value: string) => UUID_PATTERN.test(value));
}

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (value: string) => DATE_TIME_PATTERN.test(value));
}

/**
 * Minimal absolute-URI shape check: `scheme://` prefix (RFC 3986 §3.1) plus
 * a non-empty remainder. This package has no `@types/node`/DOM lib
 * dependency to reach for a real URL parser (`AgentRuntimeConfigDtoSchema`
 * is the only current consumer, LLD §6.3, and its `endpoints` values are
 * always absolute `http(s)://` URLs), so a conservative pattern is enough
 * to reject obviously-malformed values without pulling in a runtime-specific
 * global.
 */
const URI_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

if (!FormatRegistry.Has('uri')) {
  FormatRegistry.Set('uri', (value: string) => URI_PATTERN.test(value));
}
