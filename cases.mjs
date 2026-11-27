// Replays the cases of cases/*.json with the reader of this repository. The files are plain data: a reader in
// another language can run the same cases, see cases/README.md.
// usage: node cases.mjs [file ...]
import fs from 'node:fs';
import { render, Refused } from './reader.mjs';

const files = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync('cases').filter((f) => f.endsWith('.json')).map((f) => `cases/${f}`);
const descriptor = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const flat = (r) => r.fields.flatMap((f) => (f.steps ? f.steps.flatMap((s) => (s.steps ? s.steps : [s])) : [f])).map((f) => `${f.label}: ${f.value}`);
let wrong = 0, total = 0;
for (const file of files) {
  const suite = JSON.parse(fs.readFileSync(file));
  const e = suite.environment;
  // the contracts the router forwards calls to are read with their own descriptors
  const called = Object.fromEntries(Object.entries(e.descriptorsOfCalledContracts ?? {}).map(([a, f]) => [a.toLowerCase(), JSON.parse(fs.readFileSync(f))]));
  const env = {
    native: e.native,
    token: (a, chain) => (chain === undefined ? e.tokens[a] : e.tokensOnOtherChains?.[`${chain}:${a}`]) ?? null,
    chain: (n) => e.chainNames?.[n],
    descriptor: (a) => called[a],
  };
  for (const c of suite.cases) {
    total++;
    let got;
    try { got = { display: flat(render(descriptor(c.router), { ...c.tx, value: BigInt(c.tx.value) }, env)) }; }
    catch (err) { if (!(err instanceof Refused)) throw err; got = { refused: true }; }
    const ok = c.refused ? got.refused === true : JSON.stringify(got.display) === JSON.stringify(c.display);
    if (!ok) { wrong++; console.log(`WRONG ${file}: ${c.name}\n  expected ${JSON.stringify(c.refused ? 'refused' : c.display)}\n  got      ${JSON.stringify(got.refused ? 'refused' : got.display)}`); }
  }
  console.log(`${file}: ${suite.cases.length} cases (${suite.cases.filter((c) => c.refused).length} refusals)`);
}
console.log(wrong ? `${wrong} of ${total} cases wrong` : `all ${total} cases as expected`);
process.exit(wrong ? 1 : 0);
