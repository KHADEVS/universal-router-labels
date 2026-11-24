import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder, id } from 'ethers';
import { render, Refused } from './reader.mjs';

const c = AbiCoder.defaultAbiCoder();
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const D20 = load('2.0'), D21 = load('2.1');
const R20 = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', R21 = '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85';
const ME = '0x1111111111111111111111111111111111111111', BAD = '0xbad0000000000000000000000000000000000bad';
const FLAG_ME = '0x0000000000000000000000000000000000000001', ZERO = '0x' + '0'.repeat(40);
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f', WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const TOKENS = { [DAI]: { symbol: 'DAI', decimals: 18 }, [WETH]: { symbol: 'WETH', decimals: 18 }, [USDC]: { symbol: 'USDC', decimals: 6 } };
const env = { native: { symbol: 'ETH', decimals: 18 }, token: (a) => TOKENS[a] ?? null };
const strip = (x) => x.slice(2);
const path = (...p) => '0x' + p.map((x) => (typeof x === 'number' ? x.toString(16).padStart(6, '0') : strip(x))).join('');

function tx(commands, inputs, { to = R20, value = 0n, deadline = 1795600000n } = {}) {
  return { from: ME, to, value, input: '0x3593564c' + strip(c.encode(['bytes', 'bytes[]', 'uint256'], [commands, inputs, deadline])) };
}
const v3 = (p, { recipient = FLAG_ME, min = 990n * 10n ** 6n } = {}) => c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [recipient, 1000n * 10n ** 18n, min, p, true]);
const PK = '(address,address,uint24,int24,address)', PATH = '(address,uint24,int24,address,bytes)[]';
const isBad = (label) => (l) => l.toLowerCase() === `${label}: ${BAD}`.toLowerCase();
const flat = (r) => r.fields.flatMap((f) => (f.steps ? f.steps.flatMap((s) => (s.steps ? s.steps : [s])) : [f])).map((f) => `${f.label}: ${f.value}`);
const shown = (d, t) => flat(render(d, t, env));
const refused = (d, t, why) => assert.throws(() => render(d, t, env), (e) => e instanceof Refused && why.test(e.message));

test('a plain V3 swap', () => {
  assert.deepEqual(shown(D20, tx('0x00', [v3(path(DAI, 500, USDC))])), ['Send: 1000 DAI', 'Minimum Output: 990 USDC', 'Recipient: You', 'Valid Until: 2026-11-25 09:46 UTC']);
});
test('a token appended to a packed path is refused (registry#3136)', () => {
  refused(D20, tx('0x00', [v3(path(DAI, 500, WETH) + strip(USDC))]), /not enough bytes/);
});
test('the output token is the last hop', () => {
  assert.ok(shown(D20, tx('0x00', [v3(path(DAI, 500, WETH, 3000, USDC))])).includes('Minimum Output: 990 USDC'));
});
test('exact output paths are read in reverse', () => {
  const x = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [FLAG_ME, 10n ** 18n, 4000n * 10n ** 6n, path(WETH, 500, USDC), true]);
  assert.deepEqual(shown(D20, tx('0x01', [x])).slice(0, 2), ['Maximum to Send: 4000 USDC', 'Receive: 1 WETH']);
});
test('the output sent to another address is shown', () => {
  assert.ok(shown(D20, tx('0x00', [v3(path(DAI, 500, USDC), { recipient: BAD })])).some(isBad('Recipient')));
});
test('a portion taken after the swap is shown', () => {
  const fee = c.encode(['address', 'address', 'uint256'], [USDC, BAD, 9900n]);
  const l = shown(D20, tx('0x0006', [v3(path(DAI, 500, USDC)), fee]));
  assert.ok(l.includes('Fee: 99%') && l.some(isBad('Fee Recipient')));
});
test('a permit inside the plan shows the spender and the amount', () => {
  const p = c.encode(['((address,uint160,uint48,uint48),address,uint256)', 'bytes'], [[[USDC, (1n << 160n) - 1n, (1n << 48n) - 1n, 0], BAD, 0], '0x']);
  const l = shown(D20, tx('0x0a', [p]));
  assert.ok(l.includes('Allow Spending: Unlimited USDC') && l.some(isBad('Spender')));
});
test('the revert-allowed flag does not hide the command', () => {
  assert.equal(shown(D20, tx('0x80', [v3(path(DAI, 500, USDC))])).length, 4);
});
test('more commands than inputs is refused', () => refused(D20, tx('0x0004', [v3(path(DAI, 500, USDC))]), /as many tags/));
test('commands without a label are refused', () => {
  for (const k of ['0x0f', '0x11', '0x12', '0x14', '0x15', '0x20', '0x22', '0x3f']) refused(D20, tx(k, ['0x']), /no case/);
});
test('2.1: command 0x40 (Across deposit) is not read as a V3 swap', () => {
  const x = v3(path(DAI, 500, USDC));
  refused(D21, tx('0x40', [x], { to: R21 }), /no case for 0x40/);
  // what the 0x3f mask of the draft's example would do on a 2.1 router
  const wrong = JSON.parse(JSON.stringify(D21).replaceAll('"0x7f"', '"0x3f"'));
  const v = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'], [FLAG_ME, 1000n * 10n ** 18n, 990n * 10n ** 6n, path(DAI, 500, USDC), true, []]);
  assert.ok(shown(wrong, tx('0x40', [v], { to: R21 })).includes('Send: 1000 DAI'));
});

const v4 = (actions, params, opt) => tx('0x10', [c.encode(['bytes', 'bytes[]'], [actions, params])], opt);
const single20 = (z, hooks = ZERO, hookData = '0x') => c.encode([`(${PK},bool,uint128,uint128,bytes)`], [[[ZERO, USDC, 500, 10, hooks], z, 10n ** 18n, 3900n * 10n ** 6n, hookData]]);
test('v4: the token sent follows the swap direction', () => {
  const end = [c.encode(['address', 'uint256'], [ZERO, 10n ** 18n]), c.encode(['address', 'uint256'], [USDC, 3900n * 10n ** 6n])];
  assert.deepEqual(shown(D20, v4('0x060c0f', [single20(true), ...end])).slice(0, 4), ['Send: 1 ETH', 'Minimum Output: 3900 USDC', 'Maximum to Send: 1 ETH', 'Minimum to Receive: 3900 USDC']);
  assert.deepEqual(shown(D20, v4('0x060c0f', [single20(false), ...end])).slice(0, 2), ['Send: 1000000000000 USDC', 'Minimum Output: 0.0000000039 ETH']);
});
test('v4: a hook and its data are shown', () => {
  const l = shown(D20, v4('0x06', [single20(true, BAD, '0x1234')]));
  assert.ok(l.some(isBad('Pool hook')) && l.includes('Hook data: 0x1234'));
});
test('v4: the output taken to another address is shown', () => {
  assert.ok(shown(D20, v4('0x060e', [single20(true), c.encode(['address', 'address', 'uint256'], [USDC, BAD, 0])])).some(isBad('Recipient')));
});
test('v4: an action without a label is refused', () => refused(D20, v4('0x0614', [single20(true), '0x']), /no case for 0x14/));

// The same multi-hop swap, encoded for 2.1 and read with the tuple of 2.0: no error, wrong amounts.
test('v4: a 2.1 multi-hop swap read with the 2.0 tuple', () => {
  const swap = c.encode([`(address,${PATH},uint256[],uint128,uint128)`], [[ZERO, [[DAI, 500, 10, ZERO, '0x'], [USDC, 100, 1, ZERO, '0x']], [], 10n ** 18n, 3900n * 10n ** 6n]]);
  const t = v4('0x07', [swap], { to: R21 });
  assert.deepEqual(shown(D21, t).slice(0, 2), ['Send: 1 ETH', 'Minimum Output: 3900 USDC']);
  const wrong = shown(D20, t).slice(0, 2);
  assert.notDeepEqual(wrong, ['Send: 1 ETH', 'Minimum Output: 3900 USDC']);
  console.log('      read with the wrong tuple:', wrong.join(' | '));
});

test('a sub-plan is read like the plan itself, and hides nothing', () => {
  const sub = c.encode(['bytes', 'bytes[]'], ['0x00', [v3(path(DAI, 500, USDC), { recipient: BAD })]]);
  const l = shown(D20, tx('0x21', [sub]));
  assert.ok(l.includes('Send: 1000 DAI') && l.some(isBad('Recipient')));
  // allowed to revert, as the interface uses it for partial fills
  assert.ok(shown(D20, tx('0xa1', [sub])).includes('Send: 1000 DAI'));
});
test('sub-plans nested too deep are refused', () => {
  let sub = c.encode(['bytes', 'bytes[]'], ['0x00', [v3(path(DAI, 500, USDC))]]);
  for (let i = 0; i < 5; i++) sub = c.encode(['bytes', 'bytes[]'], ['0x21', [sub]]);
  refused(D20, tx('0x21', [sub]), /nested too deep/);
});
test('a batch permit shows every token and the spender', () => {
  const p = c.encode(['((address,uint160,uint48,uint48)[],address,uint256)', 'bytes'], [[[[USDC, (1n << 160n) - 1n, 1795600000, 0], [DAI, 5n * 10n ** 18n, 1795600000, 0]], BAD, 0], '0x']);
  const l = shown(D20, tx('0x03', [p]));
  assert.ok(l.includes('Allow Spending: Unlimited USDC') && l.includes('Allow Spending: 5 DAI') && l.some(isBad('Spender')));
});
test('a batch transfer shows every recipient', () => {
  const p = c.encode(['(address,address,uint160,address)[]'], [[[ME, BAD, 7n * 10n ** 6n, USDC], [ME, FLAG_ME, 10n ** 18n, DAI]]]);
  const l = shown(D20, tx('0x0d', [p]));
  assert.ok(l.includes('Send: 7 USDC') && l.includes('Send: 1 DAI') && l.some(isBad('Recipient')));
});
test('2.1: a signed route shows the same plan', () => {
  const v = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'], [BAD, 1000n * 10n ** 18n, 990n * 10n ** 6n, path(DAI, 500, USDC), true, []]);
  const input = '0x' + 'XXXXXXXX' + strip(c.encode(['bytes', 'bytes[]', 'bytes32', 'bytes32', 'bool', 'bytes32', 'bytes', 'uint256'], ['0x00', [v], '0x' + '11'.repeat(32), '0x' + '22'.repeat(32), true, '0x' + '33'.repeat(32), '0x' + '44'.repeat(65), 1795600000n]));
  const sel = id('executeSigned(bytes,bytes[],bytes32,bytes32,bool,bytes32,bytes,uint256)').slice(2, 10);
  const l = shown(D21, { from: ME, to: R21, value: 0n, input: input.replace('XXXXXXXX', sel) });
  assert.ok(l.includes('Send: 1000 DAI') && l.some(isBad('Recipient')) && l.at(-1).startsWith('Valid Until'));
  refused(D20, { from: ME, to: R20, value: 0n, input: input.replace('XXXXXXXX', sel) }, /unknown selector/);
});
