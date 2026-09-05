require('ts-node/register');
require('tsconfig-paths/register');
const { ZipFile } = require('yazl');
const http = require('http');

function buildZip(entries) {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(content, 'utf8'), name);
    }
    const chunks = [];
    zipFile.outputStream.on('data', (chunk) => chunks.push(chunk));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}

const q = (text, correct='A') => JSON.stringify({ text, options: { A:'Option A', B:'Option B', C:'Option C' }, correctAnswer: correct, explanation: `Because ${correct} is right.` });

async function main() {
  const zip = await buildZip({
    'ModuleA/q1.json': q('2+2?', 'A'),
    'ModuleA/q2.json': q('3+3?', 'B'),
  });

  const setup = require('./setup3.json');
  const HOST = 'qar1-r1msnljw6d.examland.app';
  const boundary = '----qaretry1boundary';
  const fields = {
    name: 'QA Retry1 Exam',
    totalQuestions: '2',
    totalMinutes: '60',
    stageId: String(setup.stageId),
    modules: JSON.stringify([{ name: 'ModuleA', questionCount: 2 }]),
  };
  const parts = [];
  for (const [k,v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="exam.zip"\r\nContent-Type: application/zip\r\n\r\n`));
  parts.push(zip);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const result = await new Promise((resolve, reject) => {
    const r = http.request({ host:'127.0.0.1', port:4310, path:'/api/exam-types/zip', method:'POST', headers: {
      Host: HOST, Authorization: `Bearer ${setup.adminToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length,
    }}, (res) => {
      let chunks = [];
      res.on('data', c=>chunks.push(c));
      res.on('end', () => { let j; try{j=JSON.parse(Buffer.concat(chunks).toString());}catch{j=Buffer.concat(chunks).toString();} resolve({status:res.statusCode, body:j}); });
    });
    r.on('error', reject);
    r.write(body); r.end();
  });
  console.log(result.status, JSON.stringify(result.body));
  require('fs').writeFileSync('setup4.json', JSON.stringify({ examTypeId: result.body.id }, null, 2));
}
main().catch(e=>{console.error(e); process.exit(1)});
