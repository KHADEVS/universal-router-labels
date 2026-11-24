// Samples recent Ethereum Mainnet blocks and keeps the transactions sent to a Universal Router.
import fs from 'node:fs';

const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com'];
const UR = {
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b': 'V1',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'V1_2',
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af': 'V2',
  '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca': 'V2_1_1',
  '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85': 'V2_1_2',
};
const N = Number(process.argv[2] ?? 300);
const STEP = Number(process.argv[3] ?? 24);

let used = 0;
async function rpc(method, params) {
  for (let i = 0; i < 9; i++) {
    const url = RPCS[(used + i) % RPCS.length];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      if (j.result) return j.result;
    } catch {}
    used++;
    await new Promise((s) => setTimeout(s, 400 * (i + 1)));
  }
  throw new Error(`${method} ${JSON.stringify(params)} failed`);
}

const head = Number(await rpc('eth_blockNumber', [])) - 70;
const numbers = Array.from({ length: N }, (_, i) => head - i * STEP);
const out = { head, N, STEP, blocks: [], txs: [] };
let next = 0;
async function worker() {
  while (next < numbers.length) {
    const n = numbers[next++];
    let b;
    try { b = await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), true]); } catch (e) { console.error(String(e)); continue; }
    out.blocks.push({ n, t: Number(b.timestamp), txs: b.transactions.length });
    for (const t of b.transactions) {
      const v = UR[(t.to ?? '').toLowerCase()];
      if (v) out.txs.push({ v, block: n, hash: t.hash, from: t.from.toLowerCase(), value: t.value, input: t.input });
    }
    if (out.blocks.length % 25 === 0) console.log(out.blocks.length, 'blocks', out.txs.length, 'router txs');
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
fs.writeFileSync('sample.json', JSON.stringify(out));
console.log('head', head, 'blocks', out.blocks.length, 'all txs', out.blocks.reduce((a, b) => a + b.txs, 0), 'router txs', out.txs.length);
