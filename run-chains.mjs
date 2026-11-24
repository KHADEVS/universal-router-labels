// Renders the calls sampled on other chains (survey/chains/*.json.gz) with the descriptor of each router's layout.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { render, Refused } from './reader.mjs';
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const desc = { V2: load('2.0'), V2_1_1: load('2.1'), V2_1_2: load('2.1'), V2_2_0: load('2.1') };
const env = { native: { symbol: 'native', decimals: 18 }, token: () => null };
let failed = false;
console.log('| chain | blocks | transactions | router calls | on 2.0 / 2.1+ | older routers | rendered |');
console.log('|---|---|---|---|---|---|---|');
for (const f of fs.readdirSync('survey/chains').sort()) {
  const s = JSON.parse(zlib.gunzipSync(fs.readFileSync('survey/chains/' + f)));
  let ok = 0, old = 0, v20 = 0, v21 = 0; const bad = {};
  for (const t of s.txs) {
    const d = desc[t.v]; if (!d) { old++; continue; }
    t.v === 'V2' ? v20++ : v21++;
    try { render(d, { from: t.from, to: t.to, value: t.value, input: t.input }, env); ok++; }
    catch (e) { if (!(e instanceof Refused)) throw e; (bad[e.message] ??= []).push(t.hash); }
  }
  const n = v20 + v21;
  console.log(`| ${s.chain} | ${s.blocks.length} | ${s.blocks.reduce((a, b) => a + b.txs, 0)} | ${s.txs.length} | ${v20} / ${v21} | ${old} | ${ok} of ${n} |`);
  // calls to the position managers are refused on purpose, anything else is a failure
  for (const [k, v] of Object.entries(bad)) { if (!/no case for 0x1[124] /.test(k)) failed = true; console.log('   refused:', v.length, k, v.slice(0, 2).join(' ')); }
}
process.exit(failed ? 1 : 0);
