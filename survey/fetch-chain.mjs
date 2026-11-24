// Samples blocks spread over the last 24 hours of one chain and keeps the calls to its Universal Routers.
// usage: node survey/fetch-chain.mjs <chain> <blocks> <deploy-addresses dir of Uniswap/universal-router>
import fs from 'node:fs';
import zlib from 'node:zlib';

const RPC = {
  mainnet: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  base: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'],
  arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org', 'https://arb1.arbitrum.io/rpc'],
  unichain: ['https://unichain-rpc.publicnode.com', 'https://unichain.drpc.org', 'https://mainnet.unichain.org'],
  optimism: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org', 'https://mainnet.optimism.io'],
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  bsc: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'],
};
const [chain, count, dir] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
const deployed = JSON.parse(fs.readFileSync(`${dir}/${chain}.json`));
const routers = Object.fromEntries(Object.entries(deployed).filter(([k]) => k.startsWith('UniversalRouter')).map(([k, a]) => [a.toLowerCase(), k.replace('UniversalRouter', '')]));

let turn = 0;
async function rpc(method, params) {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(RPC[chain][turn % RPC[chain].length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25000) });
      const j = await r.json(); if (j.result) return j.result;
    } catch {}
    turn++; await new Promise((s) => setTimeout(s, 300 * (i + 1)));
  }
  throw new Error(`${method} failed`);
}
const block = (n, full) => rpc('eth_getBlockByNumber', ['0x' + n.toString(16), full]);
const head = Number(await rpc('eth_blockNumber', [])) - 50;
const t1 = Number((await block(head, false)).timestamp), t0 = Number((await block(head - 20000, false)).timestamp);
const perDay = Math.round(86400 / ((t1 - t0) / 20000)), step = Math.max(1, Math.floor(perDay / count));
const numbers = Array.from({ length: count }, (_, i) => head - i * step);
const out = { chain, head, count, step, routers, blocks: [], txs: [] };
let next = 0;
async function worker() {
  while (next < numbers.length) {
    const n = numbers[next++]; let b;
    try { b = await block(n, true); } catch { continue; }
    out.blocks.push({ n, t: Number(b.timestamp), txs: b.transactions.length });
    for (const t of b.transactions) { const v = routers[(t.to ?? '').toLowerCase()]; if (v) out.txs.push({ v, block: n, hash: t.hash, from: t.from.toLowerCase(), to: t.to.toLowerCase(), value: t.value, input: t.input }); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
fs.writeFileSync(new URL(`chains/${chain}.json.gz`, import.meta.url), zlib.gzipSync(JSON.stringify(out), { level: 9 }));
const ts = out.blocks.map((x) => x.t).sort((a, b) => a - b);
const byV = {}; for (const t of out.txs) byV[t.v] = (byV[t.v] ?? 0) + 1;
console.log(chain, 'blocks', out.blocks.length, new Date(ts[0] * 1000).toISOString(), '->', new Date(ts.at(-1) * 1000).toISOString(), 'txs', out.blocks.reduce((a, b) => a + b.txs, 0), 'router calls', out.txs.length, JSON.stringify(byV));
