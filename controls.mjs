// Runs the receipt check with the real descriptors, then with sabotaged ones, which must all produce differences.
import { execFileSync } from 'node:child_process';
for (const m of ['none', 'direction', 'path', 'v2path']) {
  const out = execFileSync('node', ['onchain-check.mjs', ...process.argv.slice(2)], { encoding: 'utf8', env: { ...process.env, MUTATE: m } });
  const kinds = {};
  for (const l of out.split('\n')) { const k = l.match(/^(sent|min|strict send|strict receive) 0x/); if (k) kinds[k[1]] = (kinds[k[1]] ?? 0) + 1; }
  console.log(m.padEnd(10), out.match(/differences \d+/)[0], JSON.stringify(kinds), out.match(/strictSend: \d+/)?.[0], out.match(/strictReceive: \d+/)?.[0]);
  if (m === 'none') console.log(out.split('\n').filter((l) => /^(sent|min|strict)/.test(l)).join('\n'));
}
