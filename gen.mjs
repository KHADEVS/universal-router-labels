// Writes one descriptor per router generation, in the syntax of the draft "Custom Encoding Layout for ERC-7730"
// (ethereum/ERCs#1925). 2.0 and 2.1+ need separate files: 2.1 widened the command mask and added per-hop price
// limits in the middle of several tuples.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// The position managers each router is deployed with: script/deployParameters/Deploy*.s.sol of Uniswap/universal-router.
// A descriptor has no per-deployment constant, so a file holds one chain when it names them.
export const POSITION_MANAGERS = {
  1: { v3: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', v4: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e' },
  10: { v3: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', v4: '0x3C3Ea4B57a46241e54610e5f022E5c45859A1017' },
  56: { v3: '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613', v4: '0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b' },
  130: { v3: '0x943e6e07a7E8E791dAFC44083e54041D743C46E9', v4: '0x4529A01c7A0410167c5740C487A8DE60232617bf' },
  137: { v3: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', v4: '0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9' },
  8453: { v3: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1', v4: '0x7C5f5A4bBd8fD63184577525326123B519429bDc' },
  42161: { v3: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', v4: '0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869' },
};

const FLAG_SENDER = '0x0000000000000000000000000000000000000001'; // ActionConstants.MSG_SENDER
const NATIVE = '0x0000000000000000000000000000000000000000'; // Constants.ETH, Currency.wrap(address(0))
const WHOLE_BALANCE = '0x8000000000000000000000000000000000000000000000000000000000000000'; // ActionConstants.CONTRACT_BALANCE
const MAX_U160 = '0xffffffffffffffffffffffffffffffffffffffff';

const DEPLOYMENTS = {
  '1.0': [{ chainId: 1, address: '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B' }],
  '1.2': [{ chainId: 1, address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD' }],
  '2.0': [{ chainId: 1, address: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af' }],
  '2.1': [
    { chainId: 1, address: '0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA' },
    { chainId: 1, address: '0x23617e59A5925b2A4Bf75d73ff6711cD0b29De85' },
  ],
};

const amount = (path, label, tokenPath, extra = {}) => ({
  path, label, format: 'tokenAmount', params: { tokenPath, nativeCurrencyAddress: NATIVE, ...extra },
});
const whole = { threshold: WHOLE_BALANCE, message: 'Entire router balance' };
const recipient = (path = '~.recipient', label = 'Recipient') => ({
  path, label, format: 'addressName', params: { types: ['eoa', 'contract'], sources: ['local', 'ens'], senderAddress: [FLAG_SENDER] },
});
// Only shown when the tokens come from what the router already holds.
const payer = { path: '~.payerIsUser', label: 'Paid by you', format: 'raw', visible: { ifNotIn: [true] } };
const percent = (path, label, decimals) => ({ path, label, format: 'unit', params: { base: '%', decimals, prefix: false } });

// token (20) | fee (3) | token (20) | fee (3) | token (20) ... A length other than 20 + 23n is an error, which is
// what stops an appended address from being shown as the output token (registry#3136).
const packedPath = {
  path: '~.path', format: 'customEncoding',
  params: {
    type: 'object',
    entries: [
      { name: 'first', schema: { type: 'address', bytes: 20 }, visible: 'never' },
      {
        name: 'hops', visible: 'never',
        schema: { type: 'sequence', element: { type: 'object', entries: [
          { name: 'fee', schema: { type: 'uint', bytes: 3 } },
          { name: 'token', schema: { type: 'address', bytes: 20 } },
        ] } },
      },
    ],
  },
};
const V3_FIRST = '~.path.first', V3_LAST = '~.path.hops.[-1].token';

const POOL = '(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey';
const PATH_KEYS = '(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path';

// In SETTLE and TAKE, 0 means 'everything that is open'. Hidden, because '0 USDC' would be read as nothing.

// The token of an amount depends on the swap direction.
const byDirection = (path, label, ifZeroForOne, otherwise) => ({
  path, label,
  switch: {
    expression: { path: '~.swap.zeroForOne' },
    cases: Object.fromEntries([['0x01', ifZeroForOne], ['0x00', otherwise]].map(([k, c]) => [
      k, { format: 'tokenAmount', params: { tokenPath: `~.swap.poolKey.${c}`, nativeCurrencyAddress: NATIVE } },
    ])),
  },
});
// 'Minimum Output' is what a swap must produce. It can go to the router first, with a fee taken after it, so it is
// not what the user gets. 'Minimum to Receive' is kept for the steps that pay the user.
const hook = (path) => ({ path, label: 'Pool hook', format: 'addressName', params: { types: ['contract'] }, visible: { ifNotIn: [NATIVE] } });
const hookData = (path) => ({ path, label: 'Hook data', format: 'raw', visible: { ifNotIn: ['0x'] } });

// The files written here are for Mainnet. Another chain has other position managers, and its own list of routers:
// build(version, chainId) gives its descriptor without that list.
export function build(version, chainId = 1) {
  const v21 = version === '2.1';
  // The input of these commands is a whole call, selector included, that the router forwards to a position manager.
  const forwarded = (manager) => ({ format: 'calldata', params: { callee: `$.metadata.constants.${manager}` } });
  const hop = v21 ? ',uint256[] minHopPriceX36' : '';
  const single = v21 ? ',uint256 minHopPriceX36' : '';
  const multi = v21 ? ',uint256[] minHopPriceX36' : '';

  const actions = {
    '0x06': { [`((${POOL},bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum${single},bytes hookData) swap)`]: {
      intent: 'Swap', fields: [
        byDirection('~.swap.amountIn', 'Send', 'currency0', 'currency1'),
        byDirection('~.swap.amountOutMinimum', 'Minimum Output', 'currency1', 'currency0'),
        hook('~.swap.poolKey.hooks'), hookData('~.swap.hookData'),
      ] } },
    '0x07': { [`((address currencyIn,${PATH_KEYS}${multi},uint128 amountIn,uint128 amountOutMinimum) swap)`]: {
      intent: 'Swap', fields: [
        amount('~.swap.amountIn', 'Send', '~.swap.currencyIn'),
        amount('~.swap.amountOutMinimum', 'Minimum Output', '~.swap.path.[-1].intermediateCurrency'),
        hook('~.swap.path.[].hooks'), hookData('~.swap.path.[].hookData'),
      ] } },
    '0x08': { [`((${POOL},bool zeroForOne,uint128 amountOut,uint128 amountInMaximum${single},bytes hookData) swap)`]: {
      intent: 'Swap', fields: [
        byDirection('~.swap.amountInMaximum', 'Maximum to Send', 'currency0', 'currency1'),
        byDirection('~.swap.amountOut', 'Receive', 'currency1', 'currency0'),
        hook('~.swap.poolKey.hooks'), hookData('~.swap.hookData'),
      ] } },
    '0x09': { [`((address currencyOut,${PATH_KEYS}${multi},uint128 amountOut,uint128 amountInMaximum) swap)`]: {
      intent: 'Swap', fields: [
        amount('~.swap.amountInMaximum', 'Maximum to Send', '~.swap.path.[0].intermediateCurrency'),
        amount('~.swap.amountOut', 'Receive', '~.swap.currencyOut'),
        hook('~.swap.path.[].hooks'), hookData('~.swap.path.[].hookData'),
      ] } },
    '0x0b': { '(address currency,uint256 amount,bool payerIsUser)': { intent: 'Pay', fields: [
      { ...amount('~.amount', 'Pay Pool', '~.currency', whole), visible: { ifNotIn: [0] } }, payer ] } },
    '0x0c': { '(address currency,uint256 maxAmount)': { intent: 'Pay', fields: [ amount('~.maxAmount', 'Maximum to Send', '~.currency') ] } },
    '0x0e': { '(address currency,address recipient,uint256 amount)': { intent: 'Receive', fields: [
      { ...amount('~.amount', 'Take from Pool', '~.currency'), visible: { ifNotIn: [0] } }, recipient() ] } },
    '0x0f': { '(address currency,uint256 minAmount)': { intent: 'Receive', fields: [ amount('~.minAmount', 'Minimum to Receive', '~.currency') ] } },
    '0x10': { '(address currency,address recipient,uint256 bips)': { intent: 'Fee', fields: [
      percent('~.bips', 'Fee', 2), { path: '~.currency', label: 'Fee Token', format: 'addressName', params: { types: ['token'] } }, recipient('~.recipient', 'Fee Recipient') ] } },
    $default: 'reject',
  };

  const cases = {
    '0x00': { [`(address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser${hop})`]: {
      intent: 'Swap', fields: [ packedPath,
        amount('~.amountIn', 'Send', V3_FIRST, whole),
        amount('~.amountOutMinimum', 'Minimum Output', V3_LAST),
        recipient(), payer ] } },
    '0x01': { [`(address recipient,uint256 amountOut,uint256 amountInMaximum,bytes path,bool payerIsUser${hop})`]: {
      intent: 'Swap', fields: [ packedPath, // exact-output paths are reversed: the first token is the one received
        amount('~.amountInMaximum', 'Maximum to Send', V3_LAST),
        amount('~.amountOut', 'Receive', V3_FIRST),
        recipient(), payer ] } },
    '0x02': { '(address token,address recipient,uint160 amount)': { intent: 'Send', fields: [ amount('~.amount', 'Send', '~.token'), recipient() ] } },
    '0x04': { '(address token,address recipient,uint256 amountMinimum)': { intent: 'Collect', fields: [
      amount('~.amountMinimum', 'Collect at Least', '~.token'), recipient() ] } },
    '0x05': { '(address token,address recipient,uint256 value)': { intent: 'Send', fields: [ amount('~.value', 'Send', '~.token', whole), recipient() ] } },
    '0x06': { '(address token,address recipient,uint256 bips)': { intent: 'Fee', fields: [
      percent('~.bips', 'Fee', 2), { path: '~.token', label: 'Fee Token', format: 'addressName', params: { types: ['token'] } }, recipient('~.recipient', 'Fee Recipient') ] } },
    '0x08': { [`(address recipient,uint256 amountIn,uint256 amountOutMinimum,address[] path,bool payerIsUser${hop})`]: {
      intent: 'Swap', fields: [
        amount('~.amountIn', 'Send', '~.path.[0]', whole), amount('~.amountOutMinimum', 'Minimum Output', '~.path.[-1]'), recipient(), payer ] } },
    '0x09': { [`(address recipient,uint256 amountOut,uint256 amountInMaximum,address[] path,bool payerIsUser${hop})`]: {
      intent: 'Swap', fields: [
        amount('~.amountInMaximum', 'Maximum to Send', '~.path.[0]'), amount('~.amountOut', 'Receive', '~.path.[-1]'), recipient(), payer ] } },
    '0x0a': { '(((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline) permit,bytes signature)': {
      intent: 'Approve', fields: [
        amount('~.permit.details.amount', 'Allow Spending', '~.permit.details.token', { threshold: MAX_U160, message: 'Unlimited' }),
        { path: '~.permit.spender', label: 'Spender', format: 'addressName', params: { types: ['eoa', 'contract'] } },
        { path: '~.permit.details.expiration', label: 'Approval Expires', format: 'date', params: { encoding: 'timestamp' } },
      ] } },
    '0x0b': { '(address recipient,uint256 amount)': { intent: 'Wrap', fields: [
      { path: '~.amount', label: 'Wrap', format: 'tokenAmount', params: { token: NATIVE, nativeCurrencyAddress: NATIVE, ...whole } }, recipient() ] } },
    '0x0c': { '(address recipient,uint256 amountMinimum)': { intent: 'Unwrap', fields: [
      { path: '~.amountMinimum', label: 'Minimum to Receive', format: 'amount' }, recipient() ] } },
    '0x0e': { '(address owner,address token,uint256 minBalance)': { intent: 'Check', fields: [
      amount('~.minBalance', 'Require Balance of', '~.token'), { path: '~.owner', label: 'Owner', format: 'addressName', params: { types: ['eoa', 'contract'] } } ] } },
    '0x10': { '(bytes actions,bytes[] params)': { intent: 'Swap', fields: [
      { path: '~.actions', visible: 'never', format: 'customEncoding', params: { type: 'sequence', element: { type: 'uint', bytes: 1 } } },
      { path: '~.params.[]', label: 'Pool action', switch: { expression: { path: '~.actions.[$index]' }, cases: actions } },
    ] } },
    '0x03': { '(((address token,uint160 amount,uint48 expiration,uint48 nonce)[] details,address spender,uint256 sigDeadline) permit,bytes signature)': {
      intent: 'Approve', fields: [
        amount('~.permit.details.[].amount', 'Allow Spending', '~.permit.details.[].token', { threshold: MAX_U160, message: 'Unlimited' }),
        { path: '~.permit.spender', label: 'Spender', format: 'addressName', params: { types: ['eoa', 'contract'] } },
        { path: '~.permit.details.[].expiration', label: 'Approval Expires', format: 'date', params: { encoding: 'timestamp' } },
      ] } },
    // every `from` must be the caller, or the router reverts (FromAddressIsNotOwner)
    '0x0d': { '((address from,address to,uint160 amount,address token)[] transfers)': { intent: 'Send', fields: [
      amount('~.transfers.[].amount', 'Send', '~.transfers.[].token'), recipient('~.transfers.[].to') ] } },
    '0x13': { '((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint160 sqrtPriceX96)': { intent: 'Create pool', fields: [
      { path: '~.poolKey.currency0', label: 'Token', format: 'addressName', params: { types: ['token'] } },
      { path: '~.poolKey.currency1', label: 'Token', format: 'addressName', params: { types: ['token'] } },
      hook('~.poolKey.hooks'),
      { path: '~.sqrtPriceX96', label: 'Starting Price (sqrt, Q96)', format: 'raw' },
    ] } },
    // Moving a v3 position to v4. The router only lets through permit (0x11), then decreaseLiquidity, collect and
    // burn for a position the signer may manage (0x12), and modifyLiquidities without increase, decrease or burn
    // (0x14). What is shown is what the position manager's own descriptor says of the call.
    '0x11': forwarded('v3PositionManager'),
    '0x12': forwarded('v3PositionManager'),
    '0x14': forwarded('v4PositionManager'),
    // A sub-plan is the router calling its own execute(commands, inputs): the caller stays the signer.
    '0x21': { '(bytes commands,bytes[] inputs)': { intent: 'Sub-plan', fields: [
      { interaction: { to: '@.to', signature: 'execute(bytes,bytes[])', args: [{ path: '~.commands' }, { path: '~.inputs' }] } },
    ] } },
    ...(v21 ? { '0x07': { '(address token,address recipient,uint256 portion)': { intent: 'Fee', fields: [
      percent('~.portion', 'Fee', 16), { path: '~.token', label: 'Fee Token', format: 'addressName', params: { types: ['token'] } }, recipient('~.recipient', 'Fee Recipient') ] } } } : {}),
    // A deposit into the Across bridge. The router passes `depositor` and `recipient` to the pool as they are:
    // 0x…01 and 0x…02 are plain addresses here, not "the sender" and "the router". Who relays, and from when, is
    // not shown: it does not change what arrives.
    ...(v21 ? { '0x40': { '((address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes message,bool useNative) deposit)': {
      intent: 'Bridge', fields: [
        { path: '~.deposit.inputAmount', label: 'Send', switch: { expression: { path: '~.deposit.useNative' }, cases: {
          '0x01': { format: 'tokenAmount', params: { token: NATIVE, nativeCurrencyAddress: NATIVE, ...whole } },
          '0x00': { format: 'tokenAmount', params: { tokenPath: '~.deposit.inputToken', ...whole } },
        } } },
        // Without an output token the pool picks one, and a wallet cannot say which: refused.
        { path: '~.deposit.outputAmount', label: 'Receive on Destination', switch: { expression: { path: '~.deposit.outputToken' }, cases: {
          '0x00': 'reject',
          $default: { format: 'tokenAmount', params: { tokenPath: '~.deposit.outputToken', chainIdPath: '~.deposit.destinationChainId' } },
        } } },
        { path: '~.deposit.destinationChainId', label: 'Destination Chain', format: 'chainId' },
        { path: '~.deposit.recipient', label: 'Recipient on Destination', format: 'addressName', params: { types: ['eoa', 'contract'], sources: ['local', 'ens'] } },
        { path: '~.deposit.depositor', label: 'Refund Address', format: 'addressName', params: { types: ['eoa', 'contract'], sources: ['local', 'ens'] } },
        { path: '~.deposit.fillDeadline', label: 'Refunded if Not Filled by', format: 'date', params: { encoding: 'timestamp' } },
        { path: '~.deposit.message', label: 'Message for Recipient', format: 'raw', visible: { ifNotIn: ['0x'] } },
      ] } } } : {}),
    $default: 'reject',
  };
  // The routers before 2.0 have no v4 and no position commands. The first one also lacks the balance check and the
  // sub-plan, and reads five bits of a command where its successor reads six. Their NFT purchases are not
  // described: a call that holds one is refused.
  const older = version.startsWith('1.');
  if (older) for (const k of ['0x10', '0x11', '0x12', '0x13', '0x14']) delete cases[k];
  if (version === '1.0') for (const k of ['0x0e', '0x21']) delete cases[k];
  const mask = v21 ? '0x7f' : version === '1.0' ? '0x1f' : '0x3f';

  const fields = [
    { path: '#.commands', visible: 'never', format: 'customEncoding', params: { type: 'sequence', element: { type: 'uint', bytes: 1 } } },
    { path: '#.inputs.[]', label: 'Step', switch: { expression: { path: '#.commands.[$index]', mask }, cases } },
  ];
  const native = { path: '@.value', label: 'Native Amount', format: 'amount', visible: { ifNotIn: [0] } };
  return {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-non-abi-dispatch.schema.json',
    context: { $id: `Uniswap Universal Router ${version}`, contract: { deployments: chainId === 1 ? DEPLOYMENTS[version] : [] } },
    metadata: { owner: 'Uniswap Labs', contractName: 'Universal Router', info: { url: 'https://uniswap.org/' },
      ...(older ? {} : { constants: { v3PositionManager: POSITION_MANAGERS[chainId].v3, v4PositionManager: POSITION_MANAGERS[chainId].v4 } }) },
    display: { formats: {
      'execute(bytes commands,bytes[] inputs,uint256 deadline)': { $id: 'execute with deadline', intent: 'Uniswap trade',
        fields: [native, ...fields, { path: '#.deadline', label: 'Valid Until', format: 'date', params: { encoding: 'timestamp' } }] },
      'execute(bytes commands,bytes[] inputs)': { $id: 'execute', intent: 'Uniswap trade', fields: [native, ...fields] },
      // The route is also signed by a third party, for hooks that ask for it. That signature limits nothing for the user.
      ...(v21 ? { 'executeSigned(bytes commands,bytes[] inputs,bytes32 intent,bytes32 data,bool verifySender,bytes32 nonce,bytes signature,uint256 deadline)': {
        $id: 'execute signed', intent: 'Uniswap trade',
        fields: [native, ...fields, { path: '#.deadline', label: 'Valid Until', format: 'date', params: { encoding: 'timestamp' } }] } } : {}),
    } },
  };
}

// The v4 position manager: modifyLiquidities(unlockData, deadline), called directly or through the router's command
// 0x14. `unlockData` is bytes that hold abi.encode(bytes actions, bytes[] params), which takes the `abi` node of the
// fuller draft (forshtat/ERCs#14). Actions on an existing position name no pool, so their amounts stay raw, as in
// the registry's descriptor for the v3 position manager. In this contract 0x…01 is the caller and 0x…02 the
// position manager itself.
export function buildPositions(chainId = 1) {
  const raw = (path, label) => ({ path, label, format: 'raw' });
  const ticker = (path, label = 'Token') => ({ path, label, format: 'tokenTicker' });
  const position = { path: '~.tokenId', label: 'Position', format: 'nftName', params: { collectionPath: '@.to' } };
  const payer = { path: '~.payerIsUser', label: 'Paid by Caller', format: 'raw', visible: { ifNotIn: [true] } };
  const range = [raw('~.tickLower', 'Lower Tick'), raw('~.tickUpper', 'Upper Tick')];
  const mint = (liquidity) => ({ intent: 'Create position', fields: [
    amount('~.amount0Max', 'Maximum to Send', '~.poolKey.currency0'), amount('~.amount1Max', 'Maximum to Send', '~.poolKey.currency1'),
    ...(liquidity ? [raw('~.liquidity', 'Liquidity')] : []), ...range,
    recipient('~.owner', 'Position Owner'), hook('~.poolKey.hooks'), hookData('~.hookData') ] });
  const actions = {
    '0x00': { '(uint256 tokenId,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,bytes hookData)': { intent: 'Add liquidity', fields: [
      position, raw('~.liquidity', 'Liquidity to Add'), raw('~.amount0Max', 'Max Token0 (raw)'), raw('~.amount1Max', 'Max Token1 (raw)'), hookData('~.hookData') ] } },
    '0x01': { '(uint256 tokenId,uint256 liquidity,uint128 amount0Min,uint128 amount1Min,bytes hookData)': { intent: 'Remove liquidity', fields: [
      position, raw('~.liquidity', 'Liquidity to Remove'), raw('~.amount0Min', 'Min Token0 (raw)'), raw('~.amount1Min', 'Min Token1 (raw)'), hookData('~.hookData') ] } },
    '0x02': { [`(${POOL},int24 tickLower,int24 tickUpper,uint256 liquidity,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData)`]: mint(true) },
    '0x03': { '(uint256 tokenId,uint128 amount0Min,uint128 amount1Min,bytes hookData)': { intent: 'Close position', fields: [
      position, raw('~.amount0Min', 'Min Token0 (raw)'), raw('~.amount1Min', 'Min Token1 (raw)'), hookData('~.hookData') ] } },
    '0x04': { '(uint256 tokenId,uint128 amount0Max,uint128 amount1Max,bytes hookData)': { intent: 'Add liquidity', fields: [
      position, raw('~.amount0Max', 'Max Token0 (raw)'), raw('~.amount1Max', 'Max Token1 (raw)'), hookData('~.hookData') ] } },
    '0x05': { [`(${POOL},int24 tickLower,int24 tickUpper,uint128 amount0Max,uint128 amount1Max,address owner,bytes hookData)`]: mint(false) },
    // 0 is "what is owed", hidden as in the router: the token is named either way
    '0x0b': { '(address currency,uint256 amount,bool payerIsUser)': { intent: 'Pay', fields: [
      ticker('~.currency'), { ...amount('~.amount', 'Pay Pool', '~.currency', { threshold: WHOLE_BALANCE, message: 'Entire balance' }), visible: { ifNotIn: [0] } }, payer ] } },
    '0x0d': { '(address currency0,address currency1)': { intent: 'Pay', fields: [ticker('~.currency0'), ticker('~.currency1')] } },
    '0x0e': { '(address currency,address recipient,uint256 amount)': { intent: 'Receive', fields: [
      ticker('~.currency'), { ...amount('~.amount', 'Take from Pool', '~.currency'), visible: { ifNotIn: [0] } }, recipient() ] } },
    '0x11': { '(address currency0,address currency1,address recipient)': { intent: 'Receive', fields: [ticker('~.currency0'), ticker('~.currency1'), recipient()] } },
    '0x12': { '(address currency)': { intent: 'Settle', fields: [ticker('~.currency')] } },
    // what is owed is given up when it is this amount or less
    '0x13': { '(address currency,uint256 amountMax)': { intent: 'Receive', fields: [amount('~.amountMax', 'Forfeit if at Most', '~.currency')] } },
    '0x14': { '(address currency,address to)': { intent: 'Collect', fields: [ticker('~.currency', 'Collect All'), recipient('~.to')] } },
    '0x15': { '(uint256 amount)': { intent: 'Wrap', fields: [
      { path: '~.amount', label: 'Wrap', format: 'tokenAmount', params: { token: NATIVE, nativeCurrencyAddress: NATIVE, threshold: WHOLE_BALANCE, message: 'Entire balance' }, visible: { ifNotIn: [0] } } ] } },
    '0x16': { '(uint256 amount)': { intent: 'Unwrap', fields: [
      { path: '~.amount', label: 'Unwrap', format: 'tokenAmount', params: { token: NATIVE, nativeCurrencyAddress: NATIVE, threshold: WHOLE_BALANCE, message: 'Entire balance' }, visible: { ifNotIn: [0] } } ] } },
    $default: 'reject',
  };
  return {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-non-abi-dispatch.schema.json',
    context: { $id: 'Uniswap v4 Position Manager', contract: { deployments: [{ chainId, address: POSITION_MANAGERS[chainId].v4 }] } },
    metadata: { owner: 'Uniswap Labs', contractName: 'PositionManager', info: { url: 'https://uniswap.org/' } },
    display: { formats: {
      'modifyLiquidities(bytes unlockData,uint256 deadline)': { $id: 'modify liquidities', intent: 'Manage liquidity', fields: [
        { path: '#.unlockData', visible: 'never', format: 'customEncoding', params: { type: 'abi', entries: [
          { name: 'actions', schema: { type: 'bytes', format: 'customEncoding', params: { type: 'sequence', element: { type: 'uint', bytes: 1 } } } },
          { name: 'params', schema: { type: 'array', element: { type: 'bytes' } } },
        ] } },
        { path: '#.unlockData.params.[]', label: 'Step', switch: { expression: { path: '#.unlockData.actions.[$index]' }, cases: actions } },
        { path: '#.deadline', label: 'Valid Until', format: 'date', params: { encoding: 'timestamp' } },
      ] },
    } },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync('descriptors', { recursive: true });
  for (const v of ['1.0', '1.2', '2.0', '2.1']) fs.writeFileSync(`descriptors/universal-router-${v}.json`, JSON.stringify(build(v), null, 2) + '\n');
  fs.writeFileSync('descriptors/v4-position-manager.json', JSON.stringify(buildPositions(), null, 2) + '\n');
}
