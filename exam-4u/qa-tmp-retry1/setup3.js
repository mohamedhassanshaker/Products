const { req } = require('./req');
const HOST = 'qar1-r1msnljw6d.examland.app';

async function main() {
  const login = await req('POST', '/api/auth/login', HOST, null, { email:'founder+r1msnljw6d@example.test', password:'Admin-Password-1' });
  console.log('login', login.status);
  const adminToken = login.body.accessToken;

  const edu = await req('POST', '/api/taxonomy/education-levels', HOST, adminToken, {name:'Secondary'});
  console.log('edu', edu.status, edu.body);
  const stage = await req('POST', '/api/taxonomy/stages', HOST, adminToken, {educationLevelId: edu.body.id, name:'Grade 10'});
  console.log('stage', stage.status, stage.body);

  const memberEmail = 'member+r1msnljw6d@example.test';
  const reg = await req('POST', '/api/auth/register', HOST, adminToken, {email: memberEmail, password:'Member-Password-1', firstName:'Mem', lastName:'Ber'});
  console.log('reg', reg.status, reg.body);

  require('fs').writeFileSync('qa-tmp-retry1/setup3.json', JSON.stringify({ eduId: edu.body.id, stageId: stage.body.id, memberId: reg.body.user && reg.body.user.id, memberEmail, adminToken }, null, 2));
}
main().catch(e=>{console.error(e); process.exit(1)});
