// Validates the descriptors (and, as a control, the draft's own examples) with the draft's JSON schema.
// usage: node schema-check.mjs <assets/erc-0000 of ethereum/ERCs#1925> [<assets/erc-0000 of forshtat/ERCs#14>]
// A descriptor that needs the fuller draft (the `abi` node) is checked against the second schema.
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
const [dir, extended] = process.argv.slice(2);
const NEEDS_EXTENSIONS = ['v4-position-manager.json'];
const compile = (d) => {
  const schema = JSON.parse(fs.readFileSync(`${d}/erc7730-non-abi-dispatch.schema.json`));
  const A = /2020-12/.test(schema.$schema) ? Ajv2020 : Ajv;
  return new A({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
};
const base = compile(dir);
const full = extended ? compile(extended) : null;
const files = [...fs.readdirSync('descriptors').map((f) => 'descriptors/' + f), ...fs.readdirSync(dir).filter((f) => f.startsWith('example-') && f.endsWith('.json')).map((f) => `${dir}/${f}`)];
let invalid = 0;
for (const f of files) {
  const name = f.split('/').pop();
  const needs = NEEDS_EXTENSIONS.includes(name);
  if (needs && !full) { console.log('skipped', name, '(needs the schema of forshtat/ERCs#14 as a second argument)'); continue; }
  const check = needs ? full : base;
  const ok = check(JSON.parse(fs.readFileSync(f)));
  if (!ok) invalid++;
  console.log(ok ? 'valid  ' : 'INVALID', name, needs ? '(fuller draft)' : '');
  if (!ok) { const deep = [...check.errors].sort((a, b) => b.instancePath.length - a.instancePath.length).slice(0, 4); for (const e of deep) console.log('     ', e.instancePath.slice(-160), e.message, JSON.stringify(e.params)); }
}
process.exit(invalid ? 1 : 0);
