const BASE = 'http://127.0.0.1:4310';
const HOST = 'qar1-r1msnljw6d.examland.app';
const ADMIN_TOKEN_PROMISE = (async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'Content-Type':'application/json', Host: HOST}, body: JSON.stringify({email:'founder+r1msnljw6d@example.test', password:'Admin-Password-1'})});
  return (await r.json()).accessToken;
})();

async function main() {
  const adminToken = await ADMIN_TOKEN_PROMISE;
  const h = (extra={}) => ({ Host: HOST, Authorization: `Bearer ${adminToken}`, 'Content-Type':'application/json', ...extra });

  const edu = await fetch(`${BASE}/api/taxonomy/education-levels`, { method:'POST', headers: h(), body: JSON.stringify({name:'Secondary'})}).then(r=>r.json());
  console.log('edu', edu);
  const stage = await fetch(`${BASE}/api/taxonomy/stages`, { method:'POST', headers: h(), body: JSON.stringify({educationLevelId: edu.id, name:'Grade 10'})}).then(r=>r.json());
  console.log('stage', stage);

  // Register member
  const memberEmail = 'member+r1msnljw6d@example.test';
  const reg = await fetch(`${BASE}/api/auth/register`, { method:'POST', headers: h(), body: JSON.stringify({email: memberEmail, password:'Member-Password-1', firstName:'Mem', lastName:'Ber'})}).then(r=>r.json());
  console.log('reg', reg);

  require('fs').writeFileSync('qa-tmp-retry1/setup2.json', JSON.stringify({ eduId: edu.id, stageId: stage.id, memberId: reg.user.id, memberEmail }, null, 2));
}
main().catch(e=>{console.error(e); process.exit(1)});
