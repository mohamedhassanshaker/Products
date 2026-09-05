const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const BASE = 'http://127.0.0.1:4310';
const SUFFIX = 'r1' + Date.now().toString(36);
const HOST = `attretry-${SUFFIX}.examland.app`;
const dbCfg = { host: '127.0.0.1', port: 3306, user: 'root', password: 'YourPassword' };

async function main() {
  // Provision tenant via platform admin bootstrap? Simpler: use direct provisioning API if exists.
  // Check available platform endpoints - use /api/platform/tenants (needs platform admin auth). Too complex;
  // instead reuse tenant self-signup if it exists.
  const signup = await fetch(`${BASE}/api/auth/signup-tenant`, {
    method: 'POST', headers: {'Content-Type':'application/json', Host: HOST},
    body: JSON.stringify({ tenantName: 'Retry1 Tenant', subdomainSlug: `attretry-${SUFFIX}`, adminEmail: `founder+${SUFFIX}@example.test`, adminPassword: 'Admin-Password-1' })
  });
  console.log('signup status', signup.status, await signup.text());
}
main().catch(e=>{console.error(e); process.exit(1)});
