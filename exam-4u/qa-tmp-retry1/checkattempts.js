const { req } = require('./req');
const HOST = 'qar1-r1msnljw6d.localhost:4210';
async function main() {
  const login = await req('POST', '/api/auth/login', 'qar1-r1msnljw6d.examland.app', null, { email:'member+r1msnljw6d@example.test', password:'Member-Password-1' });
  const token = login.body.accessToken;
  const list = await req('GET', '/api/attempts', 'qar1-r1msnljw6d.examland.app', token, null);
  console.log(JSON.stringify(list.body, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1)});
