const { req } = require('./req');
const HOST = 'qar1-r1msnljw6d.examland.app';
const mysql = require('mysql2/promise');

async function main() {
  const setup4 = require('./setup4.json');
  const login = await req('POST', '/api/auth/login', HOST, null, { email:'member+r1msnljw6d@example.test', password:'Member-Password-1' });
  console.log('member login', login.status);
  const memberToken = login.body.accessToken;

  const start = await req('POST', '/api/attempts', HOST, memberToken, { examTypeId: setup4.examTypeId });
  console.log('start attempt', start.status, JSON.stringify(start.body));
  const attemptId = start.body.attemptId;

  const q0 = await req('GET', `/api/attempts/${attemptId}/questions/0`, HOST, memberToken, null);
  console.log('GET q0 BEFORE backdate', q0.status, JSON.stringify(q0.body).slice(0,200));

  const header0 = await req('GET', `/api/attempts/${attemptId}`, HOST, memberToken, null);
  console.log('header BEFORE backdate: status=', header0.body.status);

  // Backdate deadline_at directly in DB (real DB write, no mocked clock)
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'YourPassword', database:'t_qar1_r1msnljw6d_f14760a9' });
  await conn.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?', [attemptId]);
  console.log('backdated deadline_at for', attemptId);

  const q1 = await req('GET', `/api/attempts/${attemptId}/questions/1`, HOST, memberToken, null);
  console.log('GET q1 AFTER backdate', q1.status, JSON.stringify(q1.body));

  const [rows] = await conn.query('SELECT status FROM attempt WHERE id = ?', [attemptId]);
  console.log('DB attempt.status after the GET:', rows[0].status);

  const header1 = await req('GET', `/api/attempts/${attemptId}`, HOST, memberToken, null);
  console.log('header AFTER backdate: status=', header1.body.status);

  await conn.end();
}
main().catch(e=>{console.error(e); process.exit(1)});
