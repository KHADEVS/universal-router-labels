// Validates the descriptors (and, as a control, the draft's own examples) with the draft's JSON schema.
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
const dir = process.argv[2];
const schema = JSON.parse(fs.readFileSync(`${dir}/erc7730-non-abi-dispatch.schema.json`));
const A = /2020-12/.test(schema.$schema) ? Ajv2020 : Ajv;
const ajv = new A({ strict: false, allErrors: true, validateFormats: false });
const check = ajv.compile(schema);
const files = [...fs.readdirSync('descriptors').map((f) => 'descriptors/' + f), ...fs.readdirSync(dir).filter((f) => f.startsWith('example-')).map((f) => `${dir}/${f}`)];
for (const f of files) {
  const ok = check(JSON.parse(fs.readFileSync(f)));
  console.log(ok ? 'valid  ' : 'INVALID', f.split('/').pop());
  if (!ok) { const deep = [...check.errors].sort((a, b) => b.instancePath.length - a.instancePath.length).slice(0, 4); for (const e of deep) console.log('     ', e.instancePath.slice(-160), e.message, JSON.stringify(e.params)); }
}
