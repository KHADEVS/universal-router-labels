// How many sampled calls went to each router generation, per chain.
// usage: node survey/versions.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
const all = {};
const count = (chain, v) => { (all[chain] ??= {})[v] = (all[chain][v] ?? 0) + 1; };
const main = JSON.parse(fs.readFileSync(new URL('sample.json', import.meta.url)));
for (const t of main.txs) count('mainnet', t.v);
for (const f of fs.readdirSync(new URL('chains', import.meta.url)).sort()) {
  const s = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('chains/' + f, import.meta.url))));
  for (const t of s.txs) count(s.chain, t.v);
}
const total = {};
for (const [chain, versions] of Object.entries(all)) {
  console.log(chain, versions);
  for (const [v, n] of Object.entries(versions)) total[v] = (total[v] ?? 0) + n;
}
console.log('all chains', total);
