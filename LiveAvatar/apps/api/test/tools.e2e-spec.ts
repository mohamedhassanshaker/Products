import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { parse as parseYaml } from 'yaml';

/**
 * Tools registry CRUD + attach/detach golden path (BL-033, BL-034,
 * `docs/plans/agent-builder-v2-plan.md` Phase 8). Same real-Postgres,
 * real-HTTP-stack harness as `tenant-isolation.e2e-spec.ts` — see that
 * file's docstring for the `db push`/testcontainers rationale, which
 * applies identically here.
 */
describe('Tools registry (BL-033/034) — e2e', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  const BOOTSTRAP_SECRET = 'e2e-bootstrap-secret';
  const OPERATOR = { email: 'operator@example.com', password: 'Operator123' };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-at-least-32-characters-long';
    process.env.BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;
    // `LiveKitClientAdapter` requires these at construction time regardless
    // of whether any test in this suite ever calls a transport route — Nest
    // instantiates every provider in the module graph eagerly. e2e specs
    // bootstrap `AppModule` directly (bypassing `main.ts`'s `dotenv/config`
    // load of `apps/api/.env`), so these must be set explicitly; values
    // match `.env.example`'s documented dev-mode LiveKit defaults.
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'devsecretdevsecretdevsecret';

    execFileSync('npx', ['prisma', 'db', 'push'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

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

  it('drives create -> list -> get -> patch (+ If-Match conflict) -> test-invoke -> attach -> delete', async () => {
    const http = request(app.getHttpServer());

    await http.post('/api/auth/seed').set('X-Bootstrap-Secret', BOOTSTRAP_SECRET).send(OPERATOR).expect(201);
    const login = await http.post('/api/auth/login').send(OPERATOR).expect(200);
    const token = login.body.access_token as string;

    const tenant = await http
      .post('/api/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme', slug: 'acme-tools' })
      .expect(201);
    const tenantId = tenant.body.id as string;

    // Empty registry to start.
    const emptyList = await http
      .get(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(emptyList.body.items).toEqual([]);

    // Create — TOOL_NAME_REQUIRED on an empty name.
    await http
      .post(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', method: 'GET', url: 'https://tool-e2e.example.com/lookup' })
      .expect(400)
      .then((res) => expect(res.body.error.code).toBe('TOOL_NAME_REQUIRED'));

    // Create — TOOL_URL_INVALID on a non-https URL.
    await http
      .post(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lookup order', method: 'GET', url: 'http://tool-e2e.example.com/lookup' })
      .expect(400)
      .then((res) => expect(res.body.error.code).toBe('TOOL_URL_INVALID'));

    // Create — TOOL_CREDENTIAL_MISSING when requires_credential is set with no credential_ref.
    await http
      .post(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lookup order',
        method: 'GET',
        url: 'https://tool-e2e.example.com/lookup',
        requires_credential: true,
      })
      .expect(400)
      .then((res) => expect(res.body.error.code).toBe('TOOL_CREDENTIAL_MISSING'));

    // Real create.
    const created = await http
      .post(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Lookup order',
        method: 'GET',
        url: 'https://tool-e2e.example.com/lookup',
        lane: 'foreground',
        consequential: false,
      })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Lookup order', api_ref: 'lookup_order', lane: 'foreground' });
    const toolId = created.body.id as string;

    // Duplicate api_ref -> 409.
    await http
      .post(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lookup order (2)', method: 'GET', url: 'https://tool-e2e.example.com/lookup', api_ref: 'lookup_order' })
      .expect(409)
      .then((res) => expect(res.body.error.code).toBe('TOOL_API_REF_EXISTS'));

    // List now returns the created tool.
    const list = await http
      .get(`/api/tenants/${tenantId}/tools`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);

    // Get single.
    const got = await http
      .get(`/api/tenants/${tenantId}/tools/${toolId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(got.body.id).toBe(toolId);
    const ifMatch = got.body.updated_at as string;

    // Patch without If-Match -> 409 (missing header, per IfMatch decorator).
    await http
      .patch(`/api/tenants/${tenantId}/tools/${toolId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed tool' })
      .expect(409);

    // Patch with a stale If-Match -> 409 CONFIG_CONFLICT.
    await http
      .patch(`/api/tenants/${tenantId}/tools/${toolId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"2020-01-01T00:00:00.000Z"')
      .send({ name: 'Renamed tool' })
      .expect(409)
      .then((res) => expect(res.body.error.code).toBe('CONFIG_CONFLICT'));

    // Patch with the correct If-Match succeeds.
    const patched = await http
      .patch(`/api/tenants/${tenantId}/tools/${toolId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', ifMatch)
      .send({ name: 'Renamed tool', consequential: true })
      .expect(200);
    expect(patched.body).toMatchObject({ name: 'Renamed tool', consequential: true });

    // Test-invoke against an unresolvable host is a 200 with ok:false —
    // never a 5xx (FR-AGENT-2's "a tool failure never aborts the caller").
    const testInvoke = await http
      .post(`/api/tenants/${tenantId}/tools/${toolId}/test-invoke`)
      .set('Authorization', `Bearer ${token}`)
      .send({ arguments: { order_id: '4821' } })
      .expect(200);
    expect(testInvoke.body.ok).toBe(false);
    expect(testInvoke.body.error_code).toBe('TOOL_HTTP_ERROR');

    // Attach/detach — Phase 8 reuses the existing config draft save flow
    // (agent.tools[]), not a dedicated endpoint (see plan doc).
    const config = await http
      .get(`/api/tenants/${tenantId}/config`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const configIfMatch = config.body.updated_at as string;

    const attached = await http
      .put(`/api/tenants/${tenantId}/config`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', configIfMatch)
      .send({
        config: {
          version: 1,
          agent: { tools: [{ name: 'Renamed tool', api_ref: 'lookup_order', enabled: true }] },
        },
        save_as: 'draft',
      })
      .expect(200);
    const attachedConfig = parseYaml(attached.body.yaml_text as string) as {
      agent?: { tools?: { name: string; api_ref: string; enabled: boolean }[] };
    };
    expect(attachedConfig.agent?.tools).toEqual([{ name: 'Renamed tool', api_ref: 'lookup_order', enabled: true }]);

    // Delete.
    await http.delete(`/api/tenants/${tenantId}/tools/${toolId}`).set('Authorization', `Bearer ${token}`).expect(204);
    await http.get(`/api/tenants/${tenantId}/tools/${toolId}`).set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('rejects cross-tenant tool access with 403 TENANT_FORBIDDEN (matches providers/deployment-config, FR-TENANT-5)', async () => {
    const http = request(app.getHttpServer());
    const opLogin = await http.post('/api/auth/login').send(OPERATOR).expect(200);
    const operatorToken = opLogin.body.access_token as string;

    const tenantA = await http
      .post('/api/tenants')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Tenant A', slug: 'tools-tenant-a' })
      .expect(201);
    const tenantB = await http
      .post('/api/tenants')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Tenant B', slug: 'tools-tenant-b' })
      .expect(201);

    const invite = await http
      .post('/api/auth/invites')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ email: 'tools-admin-a@example.com', roles: ['admin'], tenant_ids: [tenantA.body.id] })
      .expect(201);
    await http
      .post('/api/auth/invites/accept')
      .send({ token: invite.body.invite_token, password: 'AdminA1234' })
      .expect(201);
    const adminLogin = await http
      .post('/api/auth/login')
      .send({ email: 'tools-admin-a@example.com', password: 'AdminA1234' })
      .expect(200);
    const adminToken = adminLogin.body.access_token as string;

    const toolInB = await http
      .post(`/api/tenants/${tenantB.body.id}/tools`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'B-only tool', method: 'GET', url: 'https://tool-e2e.example.com/b' })
      .expect(201);

    // Note: this is 403 TENANT_FORBIDDEN, not the tenants-controller's own
    // "unknown-or-unassigned collapses to 404" rule (LLD §5.1 cross-tenant
    // rule, `GetTenantUseCase`) — every nested tenant-scoped resource module
    // (providers, deployment-config, and now tools) instead does
    // findById-then-canAccessTenant, consistently returning 403 for "exists
    // but you're not assigned" (see e.g.
    // `create-provider-credential.use-case.spec.ts`'s identical assertion).
    const crossTenantRead = await http
      .get(`/api/tenants/${tenantB.body.id}/tools/${toolInB.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    expect(crossTenantRead.body.error.code).toBe('TENANT_FORBIDDEN');

    const crossTenantList = await http
      .get(`/api/tenants/${tenantB.body.id}/tools`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    expect(crossTenantList.body.error.code).toBe('TENANT_FORBIDDEN');
  });
});
