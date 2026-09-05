import type { APIRequestContext } from '@playwright/test';
import mysql from 'mysql2/promise';

/**
 * Shared helpers for Phase 10's consolidated e2e suite (sub-slices "10b1"/"10b2") — every cluster spec
 * imports from here rather than re-deriving tenant Host headers / demo credentials, so a future change
 * to the seed fixture shape (`apps/next/scripts/seed.ts`) only needs updating in one place.
 *
 * **Tenant resolution note**: this suite runs against the real, canonical root `docker-compose.yml`
 * stack (post-legacy-decommission; the transition-era `docker-compose.next.yml`/`examland-next`
 * project this suite originally targeted no longer exists), which sets `NODE_ENV=production` inside
 * the container (`next start` forces this regardless of the `NODE_ENV` value passed in — Phase 9c's
 * documented finding). That means `middleware.ts`'s REAL `Host`-header-derived tenant resolution is
 * what's under test here (not the dev/test bypass `scripts/playwright-smoke-tenant.ts` deliberately
 * relies on) — every request in this suite must carry an explicit `Host` header naming the exact
 * tenant subdomain, matching `PUBLIC_APEX_DOMAIN=examland.local` (the canonical `.env`'s own default).
 */

export const APEX_DOMAIN = process.env.NEXT_E2E_APEX_DOMAIN ?? 'examland.local';

/** The three demo tenants `npm run seed` provisions, one per package tier — see `scripts/seed.ts`. */
export const DEMO_TENANTS = {
  starter: { subdomain: 'demo-starter', adminEmail: 'admin@demo-starter.local', packageKey: 'starter' as const },
  pro: { subdomain: 'demo-pro', adminEmail: 'admin@demo-pro.local', packageKey: 'pro' as const },
  enterprise: { subdomain: 'demo-enterprise', adminEmail: 'admin@demo-enterprise.local', packageKey: 'enterprise' as const },
};

export const DEMO_TENANT_ADMIN_PASSWORD = process.env.DEMO_TENANT_ADMIN_PASSWORD?.trim() || 'Demo123!Pass';

export const PLATFORM_ADMIN_EMAIL = process.env.NEXT_PLATFORM_ADMIN_BOOTSTRAP_EMAIL ?? 'admin@examland.local';
export const PLATFORM_ADMIN_PASSWORD = process.env.NEXT_PLATFORM_ADMIN_BOOTSTRAP_PASSWORD ?? 'ExamlandAdmin1';

/** Builds the `Host` header value for a given demo tenant's subdomain. */
export function hostFor(subdomain: string): string {
  return `${subdomain}.${APEX_DOMAIN}`;
}

/** Logs in a tenant-realm user via the real `POST /api/auth/login`, returns the real bearer token.
 * Throws with the response body on a non-200 so a failing login surfaces a useful assertion message
 * rather than a generic "Cannot read token of undefined". */
export async function tenantLogin(
  request: APIRequestContext,
  subdomain: string,
  email: string,
  password: string,
): Promise<{ accessToken: string; user: { id: string } }> {
  const res = await request.post('/api/auth/login', {
    headers: { Host: hostFor(subdomain) },
    data: { email, password },
  });
  if (res.status() !== 200) {
    throw new Error(`tenantLogin(${subdomain}, ${email}) failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Logs in the seeded Platform Admin via the real `POST /api/platform/auth/login`. */
export async function platformLogin(request: APIRequestContext): Promise<{ accessToken: string }> {
  const res = await request.post('/api/platform/auth/login', {
    data: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`platformLogin failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Standard tenant-realm authenticated request headers (Host + Bearer). */
export function tenantAuthHeaders(subdomain: string, accessToken: string): Record<string, string> {
  return { Host: hostFor(subdomain), Authorization: `Bearer ${accessToken}` };
}

/** Standard platform-realm authenticated request headers (Bearer only — never tenant-resolved). */
export function platformAuthHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Direct-SQL helpers (sub-slice "10b2") — several genuine proofs in clusters 6-8 (forced session
 * staleness, backdated attempt deadlines, dedup-completed-session simulation, outbox row inspection,
 * idempotency-key deletion to simulate a lost bookkeeping write) are only provable by reaching around
 * the HTTP boundary into the real MySQL container this compose stack already exposes on the host —
 * `localhost:3306` on the canonical post-decommission stack (the transition-era stack's own
 * `docker-compose.next.yml` published `3307`; that stack no longer exists). Every prior phase's own
 * real-route integration test (e.g. `phase6c-question-review-finalize-append-routes
 * .integration.test.ts`) already establishes this exact "seed/inspect via raw SQL, drive behavior via
 * the real route" pattern — reused here at the black-box layer instead of an in-process TypeORM call.
 */
const SQL_HOST = process.env.NEXT_E2E_DB_HOST ?? 'localhost';
const SQL_PORT = Number(process.env.NEXT_E2E_DB_PORT ?? 3306);
const SQL_USER = process.env.NEXT_E2E_DB_USER ?? 'examland';
const SQL_PASSWORD = process.env.NEXT_E2E_DB_PASSWORD ?? 'examland_dev';
const PLATFORM_SCHEMA = process.env.NEXT_E2E_DB_PLATFORM_SCHEMA ?? 'examland_platform';

/** Opens a fresh connection to the platform schema (tenant directory, subscriptions, etc). */
export async function platformSql(): Promise<mysql.Connection> {
  return mysql.createConnection({ host: SQL_HOST, port: SQL_PORT, user: SQL_USER, password: SQL_PASSWORD, database: PLATFORM_SCHEMA });
}

/** Opens a fresh connection to a given tenant schema (e.g. `t_demo_starter_xxxx`). */
export async function tenantSql(schemaName: string): Promise<mysql.Connection> {
  return mysql.createConnection({ host: SQL_HOST, port: SQL_PORT, user: SQL_USER, password: SQL_PASSWORD, database: schemaName });
}

/** Resolves a demo tenant's real tenant id + schema name from the platform `tenant` table by its
 * subdomain slug — every cluster needing direct SQL access to a tenant schema starts here. */
export async function resolveTenant(subdomain: string): Promise<{ id: string; schemaName: string }> {
  const conn = await platformSql();
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT id, schema_name FROM tenant WHERE subdomain_slug = ? LIMIT 1', [subdomain]);
    if (!rows[0]) throw new Error(`resolveTenant(${subdomain}): no such tenant in platform schema`);
    return { id: rows[0].id as string, schemaName: rows[0].schema_name as string };
  } finally {
    await conn.end();
  }
}
