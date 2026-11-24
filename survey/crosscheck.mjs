// Independent check of the survey with ethers' ABI coder, strict re-encoding included.
import fs from 'node:fs';
import { AbiCoder } from 'ethers';
const c = AbiCoder.defaultAbiCoder();
const s = JSON.parse(fs.readFileSync(new URL('sample.json', import.meta.url)));
const PK = '(address,address,uint24,int24,address)';
const V20 = {
  0x00: ['address', 'uint256', 'uint256', 'bytes', 'bool'], 0x01: ['address', 'uint256', 'uint256', 'bytes', 'bool'],
  0x02: ['address', 'address', 'uint160'], 0x04: ['address', 'address', 'uint256'], 0x05: ['address', 'address', 'uint256'],
  0x06: ['address', 'address', 'uint256'], 0x07: ['address', 'address', 'uint256'],
  0x08: ['address', 'uint256', 'uint256', 'address[]', 'bool'], 0x09: ['address', 'uint256', 'uint256', 'address[]', 'bool'],
  0x0a: ['((address,uint160,uint48,uint48),address,uint256)', 'bytes'],
  0x0b: ['address', 'uint256'], 0x0c: ['address', 'uint256'], 0x0e: ['address', 'address', 'uint256'],
  0x10: ['bytes', 'bytes[]'],
};
const V21 = { ...V20 };
for (const k of [0, 1]) V21[k] = ['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'];
for (const k of [8, 9]) V21[k] = ['address', 'uint256', 'uint256', 'address[]', 'bool', 'uint256[]'];
const PATH = '(address,uint24,int24,address,bytes)[]';
const A20 = { 0x06: [`(${PK},bool,uint128,uint128,bytes)`], 0x07: [`(address,${PATH},uint128,uint128)`], 0x08: [`(${PK},bool,uint128,uint128,bytes)`], 0x09: [`(address,${PATH},uint128,uint128)`],
  0x0b: ['address', 'uint256', 'bool'], 0x0c: ['address', 'uint256'], 0x0e: ['address', 'address', 'uint256'], 0x0f: ['address', 'uint256'], 0x10: ['address', 'address', 'uint256'] };
const A21 = { ...A20, 0x06: [`(${PK},bool,uint128,uint128,uint256,bytes)`], 0x07: [`(address,${PATH},uint256[],uint128,uint128)`], 0x08: [`(${PK},bool,uint128,uint128,uint256,bytes)`], 0x09: [`(address,${PATH},uint256[],uint128,uint128)`] };

const n = {}; const inc = (k) => (n[k] = (n[k] ?? 0) + 1); const ex = {};
const eg = (k, h) => ((ex[k] ??= []).length < 4 && ex[k].push(h));
function dec(types, data, label, t) {
  let v; try { v = c.decode(types, data); } catch (e) { inc('DECODE FAIL ' + label); eg('DECODE FAIL ' + label, t.hash); return null; }
  const same = c.encode(types, v).toLowerCase() === data.toLowerCase();
  inc((same ? 'canonical ' : 'NOT CANONICAL ') + label); if (!same) eg('NOT CANONICAL ' + label, t.hash);
  return v;
}
let v4 = 0, rej = 0;
for (const t of s.txs) {
  const withDl = t.input.startsWith('0x3593564c');
  const v = dec(withDl ? ['bytes', 'bytes[]', 'uint256'] : ['bytes', 'bytes[]'], '0x' + t.input.slice(10), 'execute', t); if (!v) continue;
  const cmds = [...Buffer.from(v[0].slice(2), 'hex')]; const old = t.v === 'V2';
  if (cmds.some((x) => (x & 0x7f) === 0x10)) v4++;
  if (!cmds.every((x) => [0, 4].includes(x & 0x3f))) rej++;
  cmds.forEach((x, i) => {
    const k = x & 0x7f; const ty = (old ? V20 : V21)[k]; if (!ty) { inc('no type ' + k); return; }
    const w = dec(ty, v[1][i], t.v + ' cmd 0x' + k.toString(16).padStart(2, '0'), t); if (!w) return;
    if (k === 0x10) [...Buffer.from(w[0].slice(2), 'hex')].forEach((a, j) => {
      const at = (old ? A20 : A21)[a]; if (!at) { inc('no action ' + a); return; }
      const good = dec(at, w[1][j], t.v + ' act 0x' + a.toString(16).padStart(2, '0'), t);
      // what happens if the other version's struct is used
      const cross = (old ? A21 : A20)[a]; if (cross && cross !== at && JSON.stringify(cross) !== JSON.stringify(at)) { let r; try { r = c.decode(cross, w[1][j]); inc('CROSS-VERSION decodes without error, act 0x' + a.toString(16).padStart(2, '0') + ' on ' + t.v); if (good) { const p = good[0], q = r[0]; const amt = a === 6 || a === 8 ? [p[2] === q[2], p[3] === q[3]] : [p[old ? 2 : 3] === q[old ? 3 : 2], p[old ? 3 : 4] === q[old ? 4 : 3]]; inc('   amounts equal ' + amt.join('/')); } } catch { inc('CROSS-VERSION fails, act 0x' + a.toString(16).padStart(2, '0') + ' on ' + t.v); } }
    });
  });
}
console.log('txs', s.txs.length, 'with V4_SWAP', v4, 'not expressible with the two commands of the example', rej);
for (const k of Object.keys(n).sort()) console.log(String(n[k]).padStart(6), k);
console.log(JSON.stringify(ex, null, 1));
