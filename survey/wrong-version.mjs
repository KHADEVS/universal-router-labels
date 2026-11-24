// How many v4 multi-hop swaps of the sample are accepted, with other amounts, by the other version's descriptor?
import fs from 'node:fs';
import zlib from 'node:zlib';
import { render, Refused } from '../reader.mjs';
const load = (v) => JSON.parse(fs.readFileSync(new URL(`../descriptors/universal-router-${v}.json`, import.meta.url)));
// the mask and the extra command are left as they are: only the v4 tuples matter here
const D = { '2.0': load('2.0'), '2.1': load('2.1') };
const sample = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('sample.json.gz', import.meta.url))));
const env = { native: { symbol: 'native', decimals: 0 }, token: (a) => ({ symbol: a, decimals: 0 }) };
const multi = (r) => r.fields.flatMap((x) => x.steps ?? []).filter((x) => x.steps && x.label === 'Swap');
const n = {};
for (const t of sample.txs) {
  const own = t.v === 'V2' ? '2.0' : '2.1', other = own === '2.0' ? '2.1' : '2.0';
  const tx = { from: t.from, to: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', value: t.value, input: t.input };
  // keep the calls whose v4 plan has a multi-hop action (0x07 or 0x09)
  const single = JSON.parse(JSON.stringify(D[own])); // refuse the multi-hop actions to find them
  let has = false;
  for (const f of Object.values(single.display.formats)) { const sw = f.fields.find((x) => x.switch).switch.cases['0x10']; const a = Object.values(sw)[0].fields.find((x) => x.switch).switch.cases; delete a['0x07']; delete a['0x09']; }
  try { render(single, tx, env); } catch (e) { if (e instanceof Refused) has = true; }
  if (!has) continue;
  const key = `router ${own} read with the ${other} descriptor`; n[key] ??= { multiHop: 0, refused: 0, sameAmounts: 0, otherAmounts: 0 }; n[key].multiHop++;
  const good = JSON.stringify(multi(render(D[own], tx, env)));
  try { const r = JSON.stringify(multi(render(D[other], tx, env))); n[key][r === good ? 'sameAmounts' : 'otherAmounts']++; } catch (e) { if (!(e instanceof Refused) && !/deferred error|overflow|out-of-bounds/.test(String(e))) throw e; n[key].refused++; }
}
console.log(n);
