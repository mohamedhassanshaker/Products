const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({ host:'127.0.0.1', port:3306, user:'root', password:'YourPassword', database:'t_qar1_r1msnljw6d_f14760a9' });
  const [roles] = await conn.query("SELECT id, name FROM role WHERE name='Member'");
  console.log(roles);
  await conn.query('INSERT INTO user_role (user_id, role_id) VALUES (?, ?)', ['af40ea17-eadb-4038-b26a-c858d9004cf2', roles[0].id]);
  await conn.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
