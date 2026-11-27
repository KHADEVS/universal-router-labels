// The sampled calls that went to routers older than 2.0: which routers, and which commands they carry.
// usage: node survey/older-routers.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { AbiCoder } from 'ethers';
const c = AbiCoder.defaultAbiCoder();
const hex = (n) => '0x' + n.toString(16).padStart(2, '0');
const routers = {}, commands = {}, selectors = {};
let calls = 0;
for (const f of fs.readdirSync(new URL('chains', import.meta.url)).sort()) {
  const s = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('chains/' + f, import.meta.url))));
  for (const t of s.txs) {
    if (['V2', 'V2_1_1', 'V2_1_2', 'V2_2_0'].includes(t.v)) continue;
    calls++;
    const key = `${s.chain} ${t.to} (${t.v})`;
    routers[key] = (routers[key] ?? 0) + 1;
    selectors[t.input.slice(0, 10)] = (selectors[t.input.slice(0, 10)] ?? 0) + 1;
    const [cmds] = c.decode(['bytes', 'bytes[]'], '0x' + t.input.slice(10));
    const list = [...Buffer.from(cmds.slice(2), 'hex')];
    for (const x of new Set(list.map((b) => b & 0x3f))) commands[hex(x)] = (commands[hex(x)] ?? 0) + 1;
    if (list.some((b) => b & 0x40)) commands['bit 0x40 set'] = (commands['bit 0x40 set'] ?? 0) + 1;
  }
}
console.log(calls, 'calls to routers older than 2.0');
console.log('routers:', routers);
console.log('selectors:', selectors);
console.log('calls that contain each command:', Object.fromEntries(Object.entries(commands).sort()));
