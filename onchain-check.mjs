// Compares the labels with what happened: for successful transactions, the ERC-20 transfers in the receipt must
// respect every "Send" / "Maximum to Send" (from the signer) and the final "Minimum to Receive" (to the signer).
import fs from 'node:fs';
import { render } from './reader.mjs';
const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'];
let turn = 0;
async function rpc(method, params) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(RPCS[turn % RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json(); if (j.result) return j.result;
    } catch {}
    turn++; await new Promise((s) => setTimeout(s, 400 * (i + 1)));
  }
  return null;
}
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const mutate = { // controls: each of these must produce differences
  direction: (x) => x.replaceAll('"tokenPath": "~.swap.poolKey.currency0"', '"tokenPath": "@0"').replaceAll('"tokenPath": "~.swap.poolKey.currency1"', '"tokenPath": "~.swap.poolKey.currency0"').replaceAll('"@0"', '"~.swap.poolKey.currency1"'),
  path: (x) => x.replaceAll('~.path.hops.[-1].token', '~.path.first'),
  v2path: (x) => x.replaceAll('~.path.[-1]', '~.path.[0]'),
}[process.env.MUTATE] ?? ((x) => x);
const m = (d) => JSON.parse(mutate(JSON.stringify(d, null, 2)));
const desc = { V2: m(load('2.0')), V2_1_1: m(load('2.1')), V2_1_2: m(load('2.1')) };
const TO = { V2: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', V2_1_1: '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', V2_1_2: '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85' };
// raw units and addresses instead of symbols, so that the values can be compared
const env = { native: { symbol: 'native', decimals: 0 }, token: (a) => ({ symbol: a, decimals: 0 }) };
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const sample = JSON.parse(fs.readFileSync(process.argv[2])); const hashes = new Set(JSON.parse(fs.readFileSync(process.argv[3])));
const list = sample.txs.filter((t) => hashes.has(t.hash));
const n = { receipts: 0, failed: 0, sendChecked: 0, sendOk: 0, minChecked: 0, minOk: 0, minZero: 0 }; const bad = [];
let next = 0;
async function worker() {
  while (next < list.length) {
    const t = list[next++];
    const rc = await rpc('eth_getTransactionReceipt', [t.hash]); if (!rc) continue;
    n.receipts++; if (rc.status !== '0x1') { n.failed++; continue; }
    const flow = {}; // token -> { out, in } for the signer
    for (const l of rc.logs) if (l.topics[0] === TRANSFER && l.topics.length === 3) {
      const a = l.address.toLowerCase(), f = '0x' + l.topics[1].slice(26), to = '0x' + l.topics[2].slice(26), v = BigInt(l.data);
      flow[a] ??= { out: 0n, in: 0n }; if (f === t.from) flow[a].out += v; if (to === t.from) flow[a].in += v;
    }
    const r = render(desc[t.v], { from: t.from, to: TO[t.v], value: t.value, input: t.input }, env);
    const rows = r.fields.flatMap((x) => (x.steps ? x.steps.flatMap((s) => s.steps ?? [s]) : [x]));
    const send = {}; // the most the labels allow, per token
    for (const x of rows) if (['Send', 'Maximum to Send', 'Pay Pool'].includes(x.label)) {
      const m = x.value.match(/^(\d+) (0x\w+)$/); if (m) send[m[2]] = (send[m[2]] ?? 0n) + BigInt(m[1]);
      else if (/^Entire router balance (0x\w+)$/.test(x.value)) send[x.value.split(' ').at(-1)] ??= 0n;
    }
    for (const [tok, f] of Object.entries(flow)) if (f.out > f.in) {
      n.sendChecked++;
      if (send[tok] !== undefined && f.out - f.in <= send[tok]) n.sendOk++; else bad.push(['sent', t.hash, tok, String(f.out - f.in), String(send[tok])]);
    }
    // strict: in a plan with a single swap, the labelled tokens must be the ones that moved
    const leaf = r.fields.flatMap((x) => (x.steps ? (x.steps.some((y) => y.steps) ? x.steps : [x]) : []));
    const swaps = leaf.filter((x) => x.label === 'Swap' && x.steps);
    const wraps = r.fields.some((x) => x.label === 'Wrap' || x.label === 'Unwrap');
    if (swaps.length === 1 && !wraps) {
      const get = (...labels) => swaps[0].steps.find((x) => labels.includes(x.label))?.value.match(/^(\d+|Entire router balance) (\S+)$/);
      const out = get('Send', 'Maximum to Send'), inn = get('Minimum Output', 'Receive');
      if (out && out[2] !== 'native') { n.strictSend = (n.strictSend ?? 0) + 1; const f = flow[out[2]]; if (!f || f.out - f.in <= 0n || (/^\d/.test(out[1]) && BigInt(out[1]) > 0n && f.out - f.in > BigInt(out[1]))) bad.push(['strict send', t.hash, out[2], f ? String(f.out - f.in) : 'no movement', out[1]]); }
      const toOther = rows.some((x) => x.label === 'Recipient' && x.value !== 'You');
      if (inn && inn[2] !== 'native' && !toOther) { n.strictReceive = (n.strictReceive ?? 0) + 1; const f = flow[inn[2]]; if (!f || f.in <= 0n || f.in < BigInt(inn[1])) bad.push(['strict receive', t.hash, inn[2], f ? String(f.in) : 'no movement', inn[1]]); }
    }
    // the last minimum of each token whose output goes to the signer
    const recips = rows.filter((x) => x.label === 'Recipient').map((x) => x.value); if (recips.some((x) => x !== 'You' && x !== 'Uniswap router')) continue;
    const mins = {}; for (const x of rows) if (['Minimum to Receive', 'Collect at Least'].includes(x.label)) { const m = x.value.match(/^(\d+) (0x\w+)$/); if (m) mins[m[2]] = BigInt(m[1]); }
    for (const [tok, min] of Object.entries(mins)) if (flow[tok] && flow[tok].in > 0n) {
      if (min === 0n) { n.minZero++; continue; }
      n.minChecked++; if (flow[tok].in >= min) n.minOk++; else bad.push(['min', t.hash, tok, String(flow[tok].in), String(min)]);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log('transactions', list.length, n); for (const b of bad.slice(0, 15)) console.log(b.join(' ')); console.log('differences', bad.length);
