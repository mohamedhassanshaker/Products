/**
 * `lib/platform-console`'s barrel — the platform console's client-side data-access layer (this app's
 * equivalent of the legacy Angular app's `core/platform/*.service.ts` HTTP clients). Not a
 * module-boundary-enforced barrel like `server/**` (no ESLint override added — this directory holds
 * no server-only resource/singleton to protect, and every file here is meant to run in the browser),
 * but pages/components still import through here for a single, discoverable entry point.
 */
export * from './api-error';
export * from './auth-api';
export * from './tenants-api';
export * from './features-api';
export * from './packages-api';
export * from './ai-models-api';
export * from './billing-api';
export * from './reliability-api';
export * from './audit-log-api';
export { PlatformAuthProvider, usePlatformAuthContext } from './auth-context';
