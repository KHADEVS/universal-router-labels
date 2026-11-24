// Same coverage figures, only for transactions that set at least one non-zero limit on the output
// (swap minimum, SWEEP/UNWRAP minimum, TAKE_ALL minimum, per-hop price) or are exact-output swaps.
import fs from 'node:fs';
import { AbiCoder } from 'ethers';
const c = AbiCoder.defaultAbiCoder();
const s = JSON.parse(fs.readFileSync(new URL('sample.json', import.meta.url)));
const PK = '(address,address,uint24,int24,address)', PATH = '(address,uint24,int24,address,bytes)[]';
const bytes = (h) => [...Buffer.from(h.slice(2), 'hex')];
function analyse(t) {
  const v = c.decode(['bytes', 'bytes[]'], '0x' + t.input.slice(10)); const cmds = bytes(v[0]); const old = t.v === 'V2';
  let limit = false, swaps = 0; const acts = [];
  cmds.forEach((x, i) => {
    const k = x & 0x7f, d = v[1][i];
    if (k === 0 || k === 8) { swaps++; if (c.decode(['address', 'uint256', 'uint256'], d)[2] > 0n) limit = true; }
    if (k === 1 || k === 9) { swaps++; limit = true; }
    if (k === 4) { if (c.decode(['address', 'address', 'uint256'], d)[2] > 0n) limit = true; }
    if (k === 0x0c) { if (c.decode(['address', 'uint256'], d)[1] > 0n) limit = true; }
    if (k === 0x0e) limit = true;
    if (k === 0x10) { const [a, p] = c.decode(['bytes', 'bytes[]'], d); bytes(a).forEach((y, j) => { acts.push(y);
      if (y === 6) { swaps++; const w = c.decode([old ? `(${PK},bool,uint128,uint128,bytes)` : `(${PK},bool,uint128,uint128,uint256,bytes)`], p[j])[0]; if (w[3] > 0n || (!old && w[4] > 0n)) limit = true; }
      if (y === 7) { swaps++; const w = c.decode([old ? `(address,${PATH},uint128,uint128)` : `(address,${PATH},uint256[],uint128,uint128)`], p[j])[0]; if (w[old ? 3 : 4] > 0n) limit = true; }
      if (y === 8 || y === 9) { swaps++; limit = true; }
      if (y === 0x0f && c.decode(['address', 'uint256'], p[j])[1] > 0n) limit = true; }); }
  });
  return { cmds, acts, limit, swaps };
}
const all = s.txs.map((t) => ({ ...t, ...analyse(t) }));
for (const [name, set] of [['all', all], ['with a limit', all.filter((t) => t.limit)], ['without any limit', all.filter((t) => !t.limit)]]) {
  const p = (n) => `${n} (${(100 * n / set.length).toFixed(1)}%)`;
  const has = (ks) => set.filter((t) => t.cmds.some((x) => ks.includes(x & 0x7f))).length;
  console.log(`\n## ${name}: ${set.length} txs, ${new Set(set.map((t) => t.from)).size} senders`);
  console.log(' V4', p(has([0x10])), '| V3', p(has([0, 1])), '| V2', p(has([8, 9])), '| Permit2 permit', p(has([0x0a])));
  console.log(' routers', ['V2', 'V2_1_1', 'V2_1_2'].map((v) => v + ' ' + p(set.filter((t) => t.v === v).length)).join(' | '));
  console.log(' expressible with commands 0x00 and 0x04 only', p(set.filter((t) => t.cmds.every((x) => [0, 4].includes(x & 0x3f))).length));
  const multi = set.filter((t) => t.acts.some((a) => a === 7 || a === 9)); console.log(' v4 multi-hop', p(multi.length));
  console.log(' more than one swap', p(set.filter((t) => t.swaps > 1).length), '| fee portion', p(set.filter((t) => t.cmds.some((x) => [6, 7].includes(x & 0x7f)) || t.acts.includes(0x10)).length));
}

fs.writeFileSync(new URL('limited.json', import.meta.url), JSON.stringify(all.filter((t) => t.limit).map((t) => t.hash)));
