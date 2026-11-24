// Writes real transactions as test files in the format of the ERC-7730 registry (specs/erc7730-tests-v2.schema.json):
// a raw unsigned transaction, the token data it needs, and the expected display.
// usage: node registry-tests.mjs survey/sample.json survey/limited.json [path to the registry's tests schema]
import fs from 'node:fs';
import { AbiCoder, Transaction } from 'ethers';
import Ajv from 'ajv';
import { render } from './reader.mjs';

const c = AbiCoder.defaultAbiCoder();
const rpc = async (method, params) => {
  for (let i = 0; i < 6; i++) {
    try { const j = await (await fetch('https://ethereum-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) })).json(); if ('result' in j) return j.result; } catch {}
    await new Promise((s) => setTimeout(s, 500 * (i + 1)));
  }
  return null;
};
const text = (hex) => { try { return c.decode(['string'], hex)[0]; } catch { return Buffer.from((hex ?? '0x').slice(2), 'hex').toString().replace(/\0+$/, ''); } };
const meta = {};
async function token(a) {
  if (meta[a] !== undefined) return meta[a];
  const [symbol, name, decimals] = await Promise.all(['0x95d89b41', '0x06fdde03', '0x313ce567'].map((data) => rpc('eth_call', [{ to: a, data }, 'latest'])));
  return (meta[a] = decimals && decimals !== '0x' ? { symbol: text(symbol), name: text(name), decimals: Number(decimals) } : null);
}

const sample = JSON.parse(fs.readFileSync(process.argv[2])); const limited = new Set(JSON.parse(fs.readFileSync(process.argv[3])));
const FILES = { '2.0': ['V2'], '2.1': ['V2_1_1', 'V2_1_2'] };
const TO = { V2: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', V2_1_1: '0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca', V2_1_2: '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85' };
const bytes = (h) => [...Buffer.from(h.slice(2), 'hex')];
function shape(t) {
  const v = c.decode(['bytes', 'bytes[]'], '0x' + t.input.slice(10));
  return bytes(v[0]).map((x, i) => { const k = x & 0x7f; return k === 0x10 ? '10(' + bytes(c.decode(['bytes', 'bytes[]'], v[1][i])[0]).map((y) => y.toString(16)).join(' ') + ')' : k.toString(16); }).join(' ');
}
const registry = (rows) => rows.map((x) => (x.steps ? { label: x.group, value: { intent: x.label, fields: registry(x.steps) } } : { label: x.label, value: x.value }));

fs.mkdirSync('registry-tests', { recursive: true });
for (const [version, names] of Object.entries(FILES)) {
  const descriptor = JSON.parse(fs.readFileSync(`descriptors/universal-router-${version}.json`));
  const seen = new Map();
  for (const t of sample.txs) if (names.includes(t.v) && limited.has(t.hash)) { const s = shape(t); if (!seen.has(s)) seen.set(s, { t, n: 0 }); seen.get(s).n++; }
  const picked = [...seen.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  const tests = []; const tokens = {};
  for (const [s, { t, n }] of picked) {
    const full = await rpc('eth_getTransactionByHash', [t.hash]); if (!full) continue;
    const raw = Transaction.from({ type: Number(full.type), chainId: 1, nonce: Number(full.nonce), gasLimit: full.gas, to: full.to, value: full.value, data: full.input,
      ...(full.maxFeePerGas ? { maxFeePerGas: full.maxFeePerGas, maxPriorityFeePerGas: full.maxPriorityFeePerGas } : { gasPrice: full.gasPrice }), ...(Number(full.type) > 0 ? { accessList: full.accessList ?? [] } : {}) }).unsignedSerialized;
    const tx = { from: t.from, to: TO[t.v], value: t.value, input: t.input };
    const want = new Set(); render(descriptor, tx, { native: { symbol: 'ETH', decimals: 18 }, token: (a) => { want.add(a); return null; } });
    for (const a of want) { const m = await token(a); if (m) tokens[a] = m; }
    const r = render(descriptor, tx, { registry: true, native: { symbol: 'ETH', decimals: 18 }, token: (a) => tokens[a] ?? null });
    tests.push({ description: `${s} (${n} in the sample)`, rawTx: raw, from: Transaction.from({ to: full.from }).to, txHash: t.hash, expected: { intent: r.intent, owner: descriptor.metadata.owner, fields: registry(r.fields) } });
  }
  const file = { $schema: '../../../specs/erc7730-tests-v2.schema.json', descriptor: `../descriptors/universal-router-${version}.json`, dataProvider: { tokens: Object.fromEntries(Object.entries(tokens).sort()) }, tests };
  fs.writeFileSync(`registry-tests/calldata-UniswapUniversalRouter-${version}.tests.json`, JSON.stringify(file, null, 2) + '\n');
  let verdict = '';
  if (process.argv[4]) { const check = new Ajv({ strict: false, allErrors: true }).compile(JSON.parse(fs.readFileSync(process.argv[4]))); verdict = check(file) ? 'valid against the registry schema' : 'INVALID ' + JSON.stringify(check.errors.slice(0, 3)); }
  console.log(version, tests.length, 'tests,', Object.keys(tokens).length, 'tokens,', verdict);
}
