import fs from 'node:fs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { AbiCoder, Interface, id } from 'ethers';
import { render, Refused } from './reader.mjs';

const c = AbiCoder.defaultAbiCoder();
const load = (v) => JSON.parse(fs.readFileSync(`descriptors/universal-router-${v}.json`));
const D10 = load('1.0'), D12 = load('1.2'), D20 = load('2.0'), D21 = load('2.1');
const R10 = '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b', R12 = '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad';
const R20 = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', R21 = '0x23617e59a5925b2a4bf75d73ff6711cd0b29de85';
const ME = '0x1111111111111111111111111111111111111111', BAD = '0xbad0000000000000000000000000000000000bad';
const FLAG_ME = '0x0000000000000000000000000000000000000001', ZERO = '0x' + '0'.repeat(40);
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f', WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const TOKENS = { [DAI]: { symbol: 'DAI', decimals: 18 }, [WETH]: { symbol: 'WETH', decimals: 18 }, [USDC]: { symbol: 'USDC', decimals: 6 } };
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', WETH_UNICHAIN = '0x4200000000000000000000000000000000000006';
const ELSEWHERE = { [`8453:${USDC_BASE}`]: { symbol: 'USDC', decimals: 6 }, [`130:${WETH_UNICHAIN}`]: { symbol: 'WETH', decimals: 18 } };
const CHAINS = { 130: 'Unichain', 8453: 'Base' };
const V3_POSITIONS = '0xc36442b4a4522e871399cd717abdd847ab11fe88';
const V3_POSITIONS_FILE = 'vendor/registry/calldata-UniswapV3NonfungiblePositionManager.json';
const V4_POSITIONS = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e', V4_POSITIONS_FILE = 'descriptors/v4-position-manager.json';
const DPM = JSON.parse(fs.readFileSync(V4_POSITIONS_FILE));
const CALLED = { [V3_POSITIONS]: JSON.parse(fs.readFileSync(V3_POSITIONS_FILE)), [V4_POSITIONS]: DPM };
const env = {
  native: { symbol: 'ETH', decimals: 18 },
  token: (a, chain) => (chain === undefined ? TOKENS[a] : ELSEWHERE[`${chain}:${a}`]) ?? null,
  chain: (n) => CHAINS[n],
  // descriptors of the contracts the router forwards calls to: the registry's own file for the v3 position manager
  descriptor: (a) => CALLED[a],
};
const strip = (x) => x.slice(2);
const path = (...p) => '0x' + p.map((x) => (typeof x === 'number' ? x.toString(16).padStart(6, '0') : strip(x))).join('');

function tx(commands, inputs, { to = R20, value = 0n, deadline = 1795600000n } = {}) {
  return { from: ME, to, value, input: '0x3593564c' + strip(c.encode(['bytes', 'bytes[]', 'uint256'], [commands, inputs, deadline])) };
}
const v3 = (p, { recipient = FLAG_ME, min = 990n * 10n ** 6n } = {}) => c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [recipient, 1000n * 10n ** 18n, min, p, true]);
const PK = '(address,address,uint24,int24,address)', PATH = '(address,uint24,int24,address,bytes)[]';
const isBad = (label) => (l) => l.toLowerCase() === `${label}: ${BAD}`.toLowerCase();
const flat = (r) => r.fields.flatMap((f) => (f.steps ? f.steps.flatMap((s) => (s.steps ? s.steps : [s])) : [f])).map((f) => `${f.label}: ${f.value}`);
// Every check made against one of the router descriptors is also kept as data, for readers in other languages.
const kept = [];
let current = '';
const it = (name, fn) => test(name, () => { current = name; return fn(); });
const VERSIONS = new Map([[D10, '1.0'], [D12, '1.2'], [D20, '2.0'], [D21, '2.1']]);
const keep = (d, t, outcome) => {
  const router = VERSIONS.get(d) ?? null; // a descriptor altered for a test is not a case
  if (router) kept.push({ name: current, router, tx: { from: t.from, to: t.to, value: '0x' + BigInt(t.value).toString(16), input: t.input }, ...outcome });
};
const shown = (d, t) => { const lines = flat(render(d, t, env)); keep(d, t, { display: lines }); return lines; };
const refused = (d, t, why) => {
  assert.throws(() => render(d, t, env), (e) => e instanceof Refused && why.test(e.message));
  keep(d, t, { refused: true });
};

it('a plain V3 swap', () => {
  assert.deepEqual(shown(D20, tx('0x00', [v3(path(DAI, 500, USDC))])), ['Send: 1000 DAI', 'Minimum Output: 990 USDC', 'Recipient: You', 'Valid Until: 2026-11-25 09:46 UTC']);
});
it('a token appended to a packed path is refused (registry#3136)', () => {
  refused(D20, tx('0x00', [v3(path(DAI, 500, WETH) + strip(USDC))]), /not enough bytes/);
});
it('the output token is the last hop', () => {
  assert.ok(shown(D20, tx('0x00', [v3(path(DAI, 500, WETH, 3000, USDC))])).includes('Minimum Output: 990 USDC'));
});
it('exact output paths are read in reverse', () => {
  const x = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [FLAG_ME, 10n ** 18n, 4000n * 10n ** 6n, path(WETH, 500, USDC), true]);
  assert.deepEqual(shown(D20, tx('0x01', [x])).slice(0, 2), ['Maximum to Send: 4000 USDC', 'Receive: 1 WETH']);
});
it('the output sent to another address is shown', () => {
  assert.ok(shown(D20, tx('0x00', [v3(path(DAI, 500, USDC), { recipient: BAD })])).some(isBad('Recipient')));
});
it('a portion taken after the swap is shown', () => {
  const fee = c.encode(['address', 'address', 'uint256'], [USDC, BAD, 9900n]);
  const l = shown(D20, tx('0x0006', [v3(path(DAI, 500, USDC)), fee]));
  assert.ok(l.includes('Fee: 99%') && l.some(isBad('Fee Recipient')));
});
it('a permit inside the plan shows the spender and the amount', () => {
  const p = c.encode(['((address,uint160,uint48,uint48),address,uint256)', 'bytes'], [[[USDC, (1n << 160n) - 1n, (1n << 48n) - 1n, 0], BAD, 0], '0x']);
  const l = shown(D20, tx('0x0a', [p]));
  assert.ok(l.includes('Allow Spending: Unlimited USDC') && l.some(isBad('Spender')));
});
it('the revert-allowed flag does not hide the command', () => {
  assert.equal(shown(D20, tx('0x80', [v3(path(DAI, 500, USDC))])).length, 4);
});
it('more commands than inputs is refused', () => refused(D20, tx('0x0004', [v3(path(DAI, 500, USDC))]), /as many tags/));
it('commands without a label are refused', () => {
  for (const k of ['0x0f', '0x15', '0x20', '0x22', '0x3f']) refused(D20, tx(k, ['0x']), /no case/);
});
it('2.1: command 0x40 (Across deposit) is not read as a V3 swap', () => {
  const x = v3(path(DAI, 500, USDC));
  refused(D21, tx('0x40', [x], { to: R21 }), /does not decode/);
  // what the 0x3f mask of the draft's example would do on a 2.1 router
  const wrong = JSON.parse(JSON.stringify(D21).replaceAll('"0x7f"', '"0x3f"'));
  const v = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'], [FLAG_ME, 1000n * 10n ** 18n, 990n * 10n ** 6n, path(DAI, 500, USDC), true, []]);
  assert.ok(shown(wrong, tx('0x40', [v], { to: R21 })).includes('Send: 1000 DAI'));
});

// --- routers older than 2.0 ---
const exactOut = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool'], [FLAG_ME, 10n ** 18n, 4000n * 10n ** 6n, path(WETH, 500, USDC), true]);
it('1.x: a swap on the two older routers reads as on 2.0', () => {
  for (const [d, to] of [[D10, R10], [D12, R12]]) {
    assert.deepEqual(shown(d, tx('0x00', [v3(path(DAI, 500, USDC))], { to })), ['Send: 1000 DAI', 'Minimum Output: 990 USDC', 'Recipient: You', 'Valid Until: 2026-11-25 09:46 UTC']);
  }
});
it('1.0: the router reads five bits of a command, so 0x21 is a V3 swap there, and a sub-plan on 1.2', () => {
  assert.deepEqual(shown(D10, tx('0x21', [exactOut], { to: R10 })).slice(0, 2), ['Maximum to Send: 4000 USDC', 'Receive: 1 WETH']);
  refused(D12, tx('0x21', [exactOut], { to: R12 }), /does not decode/);
  // what the 0x3f mask of the later routers would do on the first one: a real swap is refused
  const wrong = JSON.parse(JSON.stringify(D10).replaceAll('"0x1f"', '"0x3f"'));
  assert.throws(() => render(wrong, tx('0x21', [exactOut], { to: R10 }), env), (e) => e instanceof Refused && /no case for 0x21/.test(e.message));
});
it('1.2: a sub-plan and a balance check are read', () => {
  const sub = c.encode(['bytes', 'bytes[]'], ['0x00', [v3(path(DAI, 500, USDC), { recipient: BAD })]]);
  assert.ok(shown(D12, tx('0x21', [sub], { to: R12 })).some(isBad('Recipient')));
  const check = c.encode(['address', 'address', 'uint256'], [ME, USDC, 5n * 10n ** 6n]);
  assert.deepEqual(shown(D12, tx('0x0e', [check], { to: R12 })).slice(0, 2), ['Require Balance of: 5 USDC', 'Owner: You']);
});
it('1.x: an NFT purchase, a v4 swap and a position call are refused', () => {
  for (const [d, to] of [[D10, R10], [D12, R12]]) for (const k of ['0x10', '0x11', '0x13', '0x14', '0x1c']) refused(d, tx(k, ['0x'], { to }), /no case/);
  refused(D10, tx('0x0e', ['0x'], { to: R10 }), /no case/); // no balance check on the first router
  refused(D12, tx('0x22', ['0x'], { to: R12 }), /no case/); // the approval of an NFT marketplace
});

// --- calls forwarded to the v3 position manager (moving a position to v4) ---
const positions = new Interface([
  'function permit(address spender,uint256 tokenId,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params)',
  'function burn(uint256 tokenId)',
  'function setApprovalForAll(address operator,bool approved)',
]);
const SIG = ['0x' + '11'.repeat(32), '0x' + '22'.repeat(32)], MAX128 = (1n << 128n) - 1n;
const permit = (spender) => positions.encodeFunctionData('permit', [spender, 123456n, 1795600000n, 27, ...SIG]);
const collect = (to) => positions.encodeFunctionData('collect', [[123456n, to, MAX128, MAX128]]);
it('v3 position: the steps of a move to v4 are shown with the position manager\'s own labels', () => {
  const l = shown(D20, tx('0x11121212', [permit(R20), positions.encodeFunctionData('decreaseLiquidity', [[123456n, 10n ** 6n, 1n, 2n, 1795600000n]]), collect(R20), positions.encodeFunctionData('burn', [123456n])]));
  assert.deepEqual(l, ['Operator: Uniswap router', 'Position: 123456',
    'Position: 123456', 'Liquidity to Remove: 1000000', 'Min Token0 Due (raw): 1', 'Min Token1 Due (raw): 2', 'Deadline: 2026-11-25 09:46 UTC',
    'Position: 123456', `Max Token0 (raw): ${MAX128}`, `Max Token1 (raw): ${MAX128}`, 'Recipient: Uniswap router',
    'Position: 123456', 'Valid Until: 2026-11-25 09:46 UTC']);
});
it('v3 position: a permit for someone other than the router is shown', () => {
  // the router checks that the call is a permit, not who it is for
  assert.ok(shown(D20, tx('0x11', [permit(BAD)])).some(isBad('Operator')));
});
it('v3 position: what is collected to another address is shown, and "you" stays the signer', () => {
  assert.ok(shown(D20, tx('0x12', [collect(BAD)])).some(isBad('Recipient')));
  assert.ok(shown(D20, tx('0x12', [collect(ME)])).includes('Recipient: You'));
});
it('v3 position: a call the position manager descriptor does not have is refused', () => {
  refused(D20, tx('0x12', ['0xdeadbeef' + '00'.repeat(32)]), /unknown selector/);
  refused(D20, tx('0x11', ['0x']), /unknown selector/);
});
it('v3 position: an approval for all positions is shown, though the router would revert', () => {
  assert.ok(shown(D20, tx('0x12', [positions.encodeFunctionData('setApprovalForAll', [BAD, true])])).some((x) => x.toLowerCase().includes(BAD)));
});

// --- calls forwarded to the v4 position manager ---
const manager = new Interface(['function modifyLiquidities(bytes unlockData,uint256 deadline)']);
const liquidity = (actions, params) => manager.encodeFunctionData('modifyLiquidities', [c.encode(['bytes', 'bytes[]'], [actions, params]), 1795600000n]);
const KEY = '(address,address,uint24,int24,address)';
const mint = (owner, key = [ZERO, USDC, 500, 10, ZERO]) => c.encode([KEY, 'int24', 'int24', 'uint256', 'uint128', 'uint128', 'address', 'bytes'],
  [key, -887220, 887220, 10n ** 12n, 10n ** 18n, 3900n * 10n ** 6n, owner, '0x']);
const pair = (a, b) => c.encode(['address', 'address'], [a, b]);
it('v4 position: creating a position through the router shows the amounts, the range and the owner', () => {
  assert.deepEqual(shown(D20, tx('0x14', [liquidity('0x020d', [mint(ME, [WETH, USDC, 500, 10, ZERO]), pair(WETH, USDC)])])), [
    'Maximum to Send: 1 WETH', 'Maximum to Send: 3900 USDC', 'Liquidity: 1000000000000', 'Lower Tick: -887220', 'Upper Tick: 887220', 'Position Owner: You',
    'Token: WETH', 'Token: USDC', 'Valid Until: 2026-11-25 09:46 UTC', 'Valid Until: 2026-11-25 09:46 UTC']);
});
it('v4 position: an amount in the native currency is shown, but the format cannot name it alone', () => {
  const l = shown(D20, tx('0x14', [liquidity('0x020d', [mint(ME), pair(ZERO, USDC)])]));
  assert.ok(l.includes('Maximum to Send: 1 ETH') && l.includes(`Token: (unknown token ${ZERO})`));
});
it('v4 position: through the router, the owner 0x…01 is the router, not the signer', () => {
  assert.ok(shown(D20, tx('0x14', [liquidity('0x02', [mint(FLAG_ME)])])).includes('Position Owner: Uniswap router'));
});
it('v4 position: another owner, and what is left sent elsewhere, are shown', () => {
  const l = shown(D20, tx('0x14', [liquidity('0x0214', [mint(BAD), pair(USDC, BAD)])]));
  assert.ok(l.some(isBad('Position Owner')) && l.includes('Collect All: USDC') && l.some(isBad('Recipient')));
});
it('v4 position: what is paid from the position manager, and what may be given up, are shown', () => {
  const settle = c.encode(['address', 'uint256', 'bool'], [USDC, 0n, false]), clear = c.encode(['address', 'uint256'], [USDC, 5n * 10n ** 6n]);
  assert.deepEqual(shown(D20, tx('0x14', [liquidity('0x0b13', [settle, clear])])).slice(0, 3), ['Token: USDC', 'Paid by Caller: false', 'Forfeit if at Most: 5 USDC']);
});
it('v4 position: adding to a position is shown raw, though the router would revert', () => {
  const add = c.encode(['uint256', 'uint256', 'uint128', 'uint128', 'bytes'], [77n, 10n ** 9n, 5n, 6n, '0x']);
  assert.deepEqual(shown(D20, tx('0x14', [liquidity('0x00', [add])])).slice(0, 4), ['Position: 77', 'Liquidity to Add: 1000000000', 'Max Token0 (raw): 5', 'Max Token1 (raw): 6']);
});
it('v4 position: an action the position manager does not have, or bytes that are no ABI encoding, are refused', () => {
  refused(D20, tx('0x14', [liquidity('0x06', ['0x'])]), /no case for 0x06/);
  refused(D20, tx('0x14', [manager.encodeFunctionData('modifyLiquidities', ['0x1234', 1795600000n])]), /not the ABI encoding/);
  refused(D20, tx('0x14', ['0xdeadbeef' + '00'.repeat(64)]), /unknown selector/);
});
it('v4 position: called directly, 0x…01 is the signer and 0x…02 the position manager', () => {
  const direct = flat(render(DPM, { from: ME, to: V4_POSITIONS, value: 0n, input: liquidity('0x0214', [mint(FLAG_ME), pair(USDC, FLAG_ROUTER)]) }, env));
  assert.ok(direct.includes('Position Owner: You') && direct.some((x) => x.toLowerCase() === `recipient: ${V4_POSITIONS}`));
});

// --- Across deposit (2.1+) ---
const FLAG_ROUTER = '0x0000000000000000000000000000000000000002';
const across = (o = {}) => tx('0x40', [c.encode(['(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes,bool)'], [[
  o.depositor ?? ME, o.recipient ?? ME, o.inputToken ?? USDC, o.outputToken ?? USDC_BASE, o.inputAmount ?? 1000n * 10n ** 6n, o.outputAmount ?? 999n * 10n ** 6n,
  o.chain ?? 8453n, ZERO, 1795590000, 1795603600, 0, o.message ?? '0x', o.useNative ?? false]])], { to: R21 });
it('Across: a deposit shows what arrives, on which chain, and to whom', () => {
  assert.deepEqual(shown(D21, across()), ['Send: 1000 USDC', 'Receive on Destination: 999 USDC', 'Destination Chain: Base', 'Recipient on Destination: You',
    'Refund Address: You', 'Refunded if Not Filled by: 2026-11-25 10:46 UTC', 'Valid Until: 2026-11-25 09:46 UTC']);
});
it('Across: a native deposit is shown as ETH, and the token received is looked up on the other chain', () => {
  const l = shown(D21, across({ useNative: true, inputToken: WETH, outputToken: WETH_UNICHAIN, chain: 130n, inputAmount: 10n ** 18n, outputAmount: 999n * 10n ** 15n }));
  assert.deepEqual(l.slice(0, 3), ['Send: 1 ETH', 'Receive on Destination: 0.999 WETH', 'Destination Chain: Unichain']);
  // the same address on a chain where the wallet does not know it
  assert.ok(shown(D21, across({ outputToken: WETH_UNICHAIN })).includes(`Receive on Destination: 999000000 (unknown token ${WETH_UNICHAIN})`));
});
it('Across: 0x…01 and 0x…02 are plain addresses, not "you" and "the router"', () => {
  const l = shown(D21, across({ recipient: FLAG_ME, depositor: FLAG_ROUTER }));
  assert.ok(l.includes(`Recipient on Destination: ${FLAG_ME}`) && l.includes(`Refund Address: ${FLAG_ROUTER}`));
});
it('Across: another recipient and another refund address are shown', () => {
  const l = shown(D21, across({ recipient: BAD, depositor: BAD }));
  assert.ok(l.some(isBad('Recipient on Destination')) && l.some(isBad('Refund Address')));
});
it('Across: the whole balance of the router, and a message for the recipient', () => {
  const l = shown(D21, across({ inputAmount: 1n << 255n, message: '0x1234' }));
  assert.ok(l.includes('Send: Entire router balance USDC') && l.includes('Message for Recipient: 0x1234'));
});
it('Across: a deposit that names no output token is refused', () => refused(D21, across({ outputToken: ZERO }), /no case for 0x00/));
it('Across: an unknown chain is shown by its number', () => assert.ok(shown(D21, across({ chain: 424242n })).includes('Destination Chain: chain 424242')));

const v4 = (actions, params, opt) => tx('0x10', [c.encode(['bytes', 'bytes[]'], [actions, params])], opt);
const single20 = (z, hooks = ZERO, hookData = '0x') => c.encode([`(${PK},bool,uint128,uint128,bytes)`], [[[ZERO, USDC, 500, 10, hooks], z, 10n ** 18n, 3900n * 10n ** 6n, hookData]]);
it('v4: the token sent follows the swap direction', () => {
  const end = [c.encode(['address', 'uint256'], [ZERO, 10n ** 18n]), c.encode(['address', 'uint256'], [USDC, 3900n * 10n ** 6n])];
  assert.deepEqual(shown(D20, v4('0x060c0f', [single20(true), ...end])).slice(0, 4), ['Send: 1 ETH', 'Minimum Output: 3900 USDC', 'Maximum to Send: 1 ETH', 'Minimum to Receive: 3900 USDC']);
  assert.deepEqual(shown(D20, v4('0x060c0f', [single20(false), ...end])).slice(0, 2), ['Send: 1000000000000 USDC', 'Minimum Output: 0.0000000039 ETH']);
});
it('v4: a hook and its data are shown', () => {
  const l = shown(D20, v4('0x06', [single20(true, BAD, '0x1234')]));
  assert.ok(l.some(isBad('Pool hook')) && l.includes('Hook data: 0x1234'));
});
it('v4: the output taken to another address is shown', () => {
  assert.ok(shown(D20, v4('0x060e', [single20(true), c.encode(['address', 'address', 'uint256'], [USDC, BAD, 0])])).some(isBad('Recipient')));
});
it('v4: an action without a label is refused', () => refused(D20, v4('0x0614', [single20(true), '0x']), /no case for 0x14/));

// The same multi-hop swap, encoded for 2.1 and read with the tuple of 2.0: no error, wrong amounts.
it('v4: a 2.1 multi-hop swap read with the 2.0 tuple', () => {
  const swap = c.encode([`(address,${PATH},uint256[],uint128,uint128)`], [[ZERO, [[DAI, 500, 10, ZERO, '0x'], [USDC, 100, 1, ZERO, '0x']], [], 10n ** 18n, 3900n * 10n ** 6n]]);
  const t = v4('0x07', [swap], { to: R21 });
  assert.deepEqual(shown(D21, t).slice(0, 2), ['Send: 1 ETH', 'Minimum Output: 3900 USDC']);
  const wrong = shown(D20, t).slice(0, 2);
  assert.notDeepEqual(wrong, ['Send: 1 ETH', 'Minimum Output: 3900 USDC']);
  console.log('      read with the wrong tuple:', wrong.join(' | '));
});

it('a sub-plan is read like the plan itself, and hides nothing', () => {
  const sub = c.encode(['bytes', 'bytes[]'], ['0x00', [v3(path(DAI, 500, USDC), { recipient: BAD })]]);
  const l = shown(D20, tx('0x21', [sub]));
  assert.ok(l.includes('Send: 1000 DAI') && l.some(isBad('Recipient')));
  // allowed to revert, as the interface uses it for partial fills
  assert.ok(shown(D20, tx('0xa1', [sub])).includes('Send: 1000 DAI'));
});
it('sub-plans nested too deep are refused', () => {
  let sub = c.encode(['bytes', 'bytes[]'], ['0x00', [v3(path(DAI, 500, USDC))]]);
  for (let i = 0; i < 5; i++) sub = c.encode(['bytes', 'bytes[]'], ['0x21', [sub]]);
  refused(D20, tx('0x21', [sub]), /nested too deep/);
});
it('a batch permit shows every token and the spender', () => {
  const p = c.encode(['((address,uint160,uint48,uint48)[],address,uint256)', 'bytes'], [[[[USDC, (1n << 160n) - 1n, 1795600000, 0], [DAI, 5n * 10n ** 18n, 1795600000, 0]], BAD, 0], '0x']);
  const l = shown(D20, tx('0x03', [p]));
  assert.ok(l.includes('Allow Spending: Unlimited USDC') && l.includes('Allow Spending: 5 DAI') && l.some(isBad('Spender')));
});
it('a batch transfer shows every recipient', () => {
  const p = c.encode(['(address,address,uint160,address)[]'], [[[ME, BAD, 7n * 10n ** 6n, USDC], [ME, FLAG_ME, 10n ** 18n, DAI]]]);
  const l = shown(D20, tx('0x0d', [p]));
  assert.ok(l.includes('Send: 7 USDC') && l.includes('Send: 1 DAI') && l.some(isBad('Recipient')));
});
it('2.1: a signed route shows the same plan', () => {
  const v = c.encode(['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'], [BAD, 1000n * 10n ** 18n, 990n * 10n ** 6n, path(DAI, 500, USDC), true, []]);
  const input = '0x' + 'XXXXXXXX' + strip(c.encode(['bytes', 'bytes[]', 'bytes32', 'bytes32', 'bool', 'bytes32', 'bytes', 'uint256'], ['0x00', [v], '0x' + '11'.repeat(32), '0x' + '22'.repeat(32), true, '0x' + '33'.repeat(32), '0x' + '44'.repeat(65), 1795600000n]));
  const sel = id('executeSigned(bytes,bytes[],bytes32,bytes32,bool,bytes32,bytes,uint256)').slice(2, 10);
  const l = shown(D21, { from: ME, to: R21, value: 0n, input: input.replace('XXXXXXXX', sel) });
  assert.ok(l.includes('Send: 1000 DAI') && l.some(isBad('Recipient')) && l.at(-1).startsWith('Valid Until'));
  refused(D20, { from: ME, to: R20, value: 0n, input: input.replace('XXXXXXXX', sel) }, /unknown selector/);
});

// Each run rewrites cases/built-to-mislead.json; cases.mjs replays it, and CI checks it is the committed one.
after(() => {
  const numbered = kept.map((k, i, all) => {
    const nth = all.slice(0, i).filter((x) => x.name === k.name).length + 1;
    const many = all.filter((x) => x.name === k.name).length > 1;
    return { ...k, name: many ? `${k.name} (${nth})` : k.name };
  });
  fs.mkdirSync('cases', { recursive: true });
  fs.writeFileSync('cases/built-to-mislead.json', JSON.stringify({
    about: 'Universal Router calls built to mislead a reader, with what a careful wallet shows, or the fact that it refuses. See cases/README.md.',
    environment: {
      chainId: 1, sender: ME, native: env.native, tokens: TOKENS, tokensOnOtherChains: ELSEWHERE, chainNames: CHAINS,
      descriptorsOfCalledContracts: { [V3_POSITIONS]: V3_POSITIONS_FILE, [V4_POSITIONS]: V4_POSITIONS_FILE },
      routers: { '1.0': R10, '1.2': R12, '2.0': R20, '2.1': R21 },
    },
    cases: numbered,
  }, null, 1) + '\n');
});
