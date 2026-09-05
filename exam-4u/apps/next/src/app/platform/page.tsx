import { redirect } from 'next/navigation';

/**
 * `/platform` — no screen is specified for this bare route (`docs/design/UX_GUIDELINES.md` §3.0:
 * "there is no 'dashboard' screen specified for this phase, so the tenant list *is* the landing
 * page"). The `(console)` layout's own client-side auth guard sends an unauthenticated admin on to
 * `/platform/login` from there, so this redirect target is correct regardless of auth state.
 */
export default function PlatformIndexPage() {
  redirect('/platform/tenants');
}
