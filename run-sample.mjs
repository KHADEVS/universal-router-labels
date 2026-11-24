// Renders every transaction of the survey sample with the descriptor of its router.
import fs from 'node:fs';
import { render, Refused } from './reader.mjs';
const D = { V2: '2.0', V2_1_1: '2.1', V2_1_2: '2.1' };
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const desc = { '2.0': load('2.0'), '2.1': load('2.1') };
const TO = { V2: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', V2_1_1: '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', V2_1_2: '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85' };
const env = { native: { symbol: 'ETH', decimals: 18 }, token: () => null };
const sample = JSON.parse(fs.readFileSync(process.argv[2]));
let ok = 0; const bad = {};
for (const t of sample.txs) {
  try { render(desc[D[t.v]], { from: t.from, to: TO[t.v], value: t.value, input: t.input }, env); ok++; }
  catch (e) { if (!(e instanceof Refused)) throw e; (bad[e.message] ??= []).push(t.hash); }
}
console.log('rendered', ok, 'of', sample.txs.length);
for (const [k, v] of Object.entries(bad)) console.log(v.length, k, v.slice(0, 3));
