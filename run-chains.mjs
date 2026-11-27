// Renders the calls sampled on other chains (survey/chains/*.json.gz) with the descriptor of each router's layout.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { render, Refused } from './reader.mjs';
import { build, buildPositions, POSITION_MANAGERS } from './gen.mjs';
// each chain has its own position managers, so its own descriptors
const IDS = { arbitrum: 42161, base: 8453, bsc: 56, optimism: 10, polygon: 137, unichain: 130 };
const v3Positions = JSON.parse(fs.readFileSync('vendor/registry/calldata-UniswapV3NonfungiblePositionManager.json'));
let failed = false;
console.log('| chain | blocks | transactions | router calls | on 1.x / 2.0 / 2.1+ | rendered |');
console.log('|---|---|---|---|---|---|');
for (const f of fs.readdirSync('survey/chains').sort()) {
  const s = JSON.parse(zlib.gunzipSync(fs.readFileSync('survey/chains/' + f)));
  const chainId = IDS[s.chain]; if (!chainId) throw new Error('unknown chain ' + s.chain);
  const desc = { V1: build('1.0', chainId), V1_2_V2Support: build('1.2', chainId), V1_2_NoV2Support: build('1.2', chainId),
    V2: build('2.0', chainId), V2_1_1: build('2.1', chainId), V2_1_2: build('2.1', chainId), V2_2_0: build('2.1', chainId) };
  const called = { [POSITION_MANAGERS[chainId].v3.toLowerCase()]: v3Positions, [POSITION_MANAGERS[chainId].v4.toLowerCase()]: buildPositions(chainId) };
  const env = { native: { symbol: 'native', decimals: 18 }, token: () => null, descriptor: (a) => called[a] };
  let ok = 0, old = 0, v20 = 0, v21 = 0; const bad = {};
  for (const t of s.txs) {
    const d = desc[t.v]; if (!d) throw new Error('no descriptor for router version ' + t.v);
    t.v.startsWith('V1') ? old++ : t.v === 'V2' ? v20++ : v21++;
    try { render(d, { from: t.from, to: t.to, value: t.value, input: t.input }, env); ok++; }
    catch (e) { if (!(e instanceof Refused)) throw e; (bad[e.message] ??= []).push(t.hash); }
  }
  console.log(`| ${s.chain} | ${s.blocks.length} | ${s.blocks.reduce((a, b) => a + b.txs, 0)} | ${s.txs.length} | ${old} / ${v20} / ${v21} | ${ok} of ${s.txs.length} |`);
  // every call to a router of these generations has to render
  for (const [k, v] of Object.entries(bad)) { failed = true; console.log('   refused:', v.length, k, v.slice(0, 2).join(' ')); }
}
process.exit(failed ? 1 : 0);
