import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * D-1 fix (QA phase1-backend report): the prior decision-log claim that a
 * DB-integration / cross-tenant negative e2e suite was "written but gated
 * on TEST_DATABASE_URL" was inaccurate — no such executable artifact
 * existed. This suite is the real thing: real HTTP requests (Supertest)
 * against a real, disposable Postgres (testcontainers), driving the full
 * app (AppModule) so tenant row-level isolation (FR-TENANT-5) is proven
 * end-to-end — TenantContextInterceptor populating TenantContext ALS, the
 * Prisma tenantGuard extension, and each use case's 404-vs-403 policy all
 * composing correctly across one real request — not just unit-tested in
 * isolation.
 *
 * Requires a working Docker (or Docker-compatible) daemon reachable from
 * this environment; testcontainers will fail fast with a clear error if
 * none is available. See docs/plans/liveavatar-platform-plan.md and
 * docs/NEXUS_STATE.md for whether this has actually been executed in the
 * current sandbox — a suite existing and compiling is not the same claim
 * as it having run green.
 */
describe('Tenant row-level isolation (FR-TENANT-5) — e2e', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  const BOOTSTRAP_SECRET = 'e2e-bootstrap-secret';
  const OPERATOR = { email: 'operator@example.com', password: 'Operator123' };
  const ADMIN_A = { email: 'admin-a@example.com', password: 'AdminA1234' };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    // Point the app at the disposable container DB and supply the secrets
    // AppModule's providers read from process.env at construction time.
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-at-least-32-characters-long';
    process.env.BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
    process.env.NODE_ENV = 'test';
    // Deliberately unset: exercises RedisLoginRateLimiter's documented
    // fail-safe in-memory fallback (LLD) rather than requiring a second
    // container just to authenticate a handful of test requests.
    delete process.env.REDIS_URL;
    // Phase 8 fix: `LiveKitClientAdapter` requires these at construction
    // time (Nest instantiates every provider in the module graph eagerly),
    // and this suite bootstraps `AppModule` directly, bypassing `main.ts`'s
    // `dotenv/config` load of `apps/api/.env` — without these, `compile()`
    // below throws "LIVEKIT_URL is required" before a single request runs.
    // Values match `.env.example`'s documented dev-mode LiveKit defaults.
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecretdevsecretdevsecret';

    // No migration history exists yet for this project (single schema.prisma,
    // no prisma/migrations/ directory) — `db push` applies the LLD §4.1
    // schema shape to the fresh container DB directly, which is all this
    // suite needs.
    // `npx` resolves to `npx.cmd` via PATHEXT on Windows; execFileSync does
    // not consult PATHEXT itself (only `shell: true` invokes the OS shell
    // that does), so a bare 'npx' throws ENOENT on win32 without it. Harmless
    // on POSIX, where `shell: true` still finds the same `npx` on PATH.
    //
    // `--skip-generate` was dropped by the Prisma 7 CLI (`db push` no longer
    // accepts it — verified live: passing it now fails the whole command
    // with "unknown or unexpected option"). The Prisma client used by the
    // rest of this suite is generated once up front by `pretest`/CI anyway,
    // so simply omitting the flag reproduces the same effective behavior
    // against Prisma 7.
    //
    // `--accept-data-loss` is intentionally NOT passed: this container is a
    // brand-new, empty testcontainers Postgres, so there is no existing data
    // to lose and the flag is not required for the push to succeed. It was
    // removed after live verification showed passing it trips Prisma's own
    // AI-agent safety guard (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`),
    // which refuses to run without a human's literal, explicit consent
    // message — something this harness cannot fabricate on the user's
    // behalf. Omitting the flag avoids needing that consent at all for the
    // one-time, no-op-risk schema push this suite performs against a
    // just-created disposable container.
    execFileSync('npx', ['prisma', 'db', 'push'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    // Import AppModule only after DATABASE_URL etc. are set, and only inside
    // beforeAll, so module-scope evaluation order can't race process.env.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('bootstraps an operator, then rejects a cross-tenant read with 404 (never 403) for a tenant-scoped admin', async () => {
    const http = request(app.getHttpServer());

    // 1. One-time operator bootstrap (FR-AUTH-3).
    await http
      .post('/api/auth/seed')
      .set('X-Bootstrap-Secret', BOOTSTRAP_SECRET)
      .send(OPERATOR)
      .expect(201);

    // A second seed attempt is rejected — proves AUTH_ALREADY_SEEDED end to end,
    // including the D-4 atomic createFirstOperator path.
    await http
      .post('/api/auth/seed')
      .set('X-Bootstrap-Secret', BOOTSTRAP_SECRET)
      .send({ email: 'second@example.com', password: 'Second1234' })
      .expect(409)
      .then((res) => {
        expect(res.body.error.code).toBe('AUTH_ALREADY_SEEDED');
      });

    const opLogin = await http.post('/api/auth/login').send(OPERATOR).expect(200);
    const operatorToken = opLogin.body.access_token as string;
    expect(operatorToken).toEqual(expect.any(String));

    // 2. Create two tenants as the operator.
    const tenantA = await http
      .post('/api/tenants')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Tenant A', slug: 'tenant-a' })
      .expect(201);
    const tenantB = await http
      .post('/api/tenants')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Tenant B', slug: 'tenant-b' })
      .expect(201);

    // 3. Invite + accept an admin scoped only to tenant A.
    const invite = await http
      .post('/api/auth/invites')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ email: ADMIN_A.email, roles: ['admin'], tenant_ids: [tenantA.body.id] })
      .expect(201);

    await http
      .post('/api/auth/invites/accept')
      .send({ token: invite.body.invite_token, password: ADMIN_A.password })
      .expect(201);

    const adminLogin = await http.post('/api/auth/login').send(ADMIN_A).expect(200);
    const adminToken = adminLogin.body.access_token as string;
    expect(adminLogin.body.user.tenant_ids).toEqual([tenantA.body.id]);

    // 4. The admin's own assigned tenant is visible.
    await http
      .get(`/api/tenants/${tenantA.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((res) => {
        expect(res.body.id).toBe(tenantA.body.id);
      });

    // 5. A tenant the admin is NOT assigned to must be a 404 — never a 403,
    // which would leak that the id exists elsewhere (LLD §5.1 cross-tenant rule).
    const crossTenantRead = await http
      .get(`/api/tenants/${tenantB.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(crossTenantRead.body.error.code).toBe('TENANT_NOT_FOUND');

    // 6. A wholly unknown id gets byte-for-byte the same error envelope as
    // the real-but-unassigned tenant id — no side channel distinguishes
    // "exists but forbidden" from "never existed".
    const unknownIdRead = await http
      .get('/api/tenants/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
    expect(unknownIdRead.body).toEqual(crossTenantRead.body);

    // 7. Mutating an unassigned tenant is also rejected — and must be 404,
    // never 403 (FR-TENANT-5 / HLD §7 layer 3: 403 here would let an
    // authenticated admin enumerate which tenant UUIDs exist on the
    // platform). This must match the GET path's status exactly, not merely
    // "some rejection".
    const crossTenantUpdate = await http
      .patch(`/api/tenants/${tenantB.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('If-Match', '"1"')
      .send({ name: 'Hijacked name' })
      .expect(404);
    expect(crossTenantUpdate.body.error.code).toBe('TENANT_NOT_FOUND');

    // 8. And the tenant's data was genuinely untouched by the rejected write.
    const tenantBAfter = await http
      .get(`/api/tenants/${tenantB.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(tenantBAfter.body.name).toBe('Tenant B');
  });
});
