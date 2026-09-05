const { req } = require('./req');
async function main() {
  const login = await req('POST', '/api/auth/login', 'qar1-r1msnljw6d.examland.app', null, { email:'member+r1msnljw6d@example.test', password:'Member-Password-1' });
  const token = login.body.accessToken;
  // Submit the stuck InProgress attempt first so a new one can start (single-in-progress invariant)
  const submit = await req('POST', '/api/attempts/3845a3f1-48b5-48c6-b55d-a8e6c56a2b24/submit', 'qar1-r1msnljw6d.examland.app', token, null);
  console.log('submit old', submit.status, JSON.stringify(submit.body));
  const start = await req('POST', '/api/attempts', 'qar1-r1msnljw6d.examland.app', token, { examTypeId: '56cb02e0-352a-406d-b593-2dd14be64e4d' });
  console.log('start', start.status, JSON.stringify(start.body));
}
main().catch(e=>{console.error(e);process.exit(1)});
