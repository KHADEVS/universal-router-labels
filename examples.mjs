// Prints a few real transactions of the sample as a wallet would show them, with token metadata read on chain.
import fs from 'node:fs';
import { AbiCoder } from 'ethers';
import { render } from './reader.mjs';
const rpc = async (method, params) => (await (await fetch('https://ethereum-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const desc = { V2: load('2.0'), V2_1_1: load('2.1'), V2_1_2: load('2.1') };
const TO = { V2: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', V2_1_1: '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', V2_1_2: '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85' };
const sample = JSON.parse(fs.readFileSync(process.argv[2]));
const meta = {};
async function token(a) {
  const sym = await rpc('eth_call', [{ to: a, data: '0x95d89b41' }, 'latest']); const dec = await rpc('eth_call', [{ to: a, data: '0x313ce567' }, 'latest']);
  let symbol; try { symbol = AbiCoder.defaultAbiCoder().decode(['string'], sym)[0]; } catch { symbol = Buffer.from((sym ?? '0x').slice(2), 'hex').toString().replace(/\0+$/, ''); }
  return { symbol, decimals: Number(dec ?? 0) };
}
for (const h of process.argv.slice(3)) {
  const t = sample.txs.find((x) => x.hash === h); if (!t) { console.log('not in sample', h); continue; }
  const want = new Set(); const tx = { from: t.from, to: TO[t.v], value: t.value, input: t.input };
  render(desc[t.v], tx, { native: { symbol: 'ETH', decimals: 18 }, token: (a) => { want.add(a); return null; } });
  for (const a of want) meta[a] ??= await token(a);
  const r = render(desc[t.v], tx, { native: { symbol: 'ETH', decimals: 18 }, token: (a) => meta[a] ?? null });
  console.log('\n' + h, t.v); console.log(r.intent);
  const print = (rows, pad) => rows.forEach((x) => { if (x.steps) { console.log(pad + '[' + x.label + ']'); print(x.steps, pad + '   '); } else console.log(pad + x.label + ': ' + x.value); });
  print(r.fields, '   ');
}
