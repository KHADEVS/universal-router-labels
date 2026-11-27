// Writes one descriptor per router generation, in the syntax of the draft "Custom Encoding Layout for ERC-7730"
// (ethereum/ERCs#1925). 2.0 and 2.1+ need separate files: 2.1 widened the command mask and added per-hop price
// limits in the middle of several tuples.
import fs from 'node:fs';

const FLAG_SENDER = '0x0000000000000000000000000000000000000001'; // ActionConstants.MSG_SENDER
const NATIVE = '0x0000000000000000000000000000000000000000'; // Constants.ETH, Currency.wrap(address(0))
const WHOLE_BALANCE = '0x8000000000000000000000000000000000000000000000000000000000000000'; // ActionConstants.CONTRACT_BALANCE
const MAX_U160 = '0xffffffffffffffffffffffffffffffffffffffff';

const DEPLOYMENTS = {
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

function build(version) {
  const v21 = version === '2.1';
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

  const fields = [
    { path: '#.commands', visible: 'never', format: 'customEncoding', params: { type: 'sequence', element: { type: 'uint', bytes: 1 } } },
    { path: '#.inputs.[]', label: 'Step', switch: { expression: { path: '#.commands.[$index]', mask: v21 ? '0x7f' : '0x3f' }, cases } },
  ];
  const native = { path: '@.value', label: 'Native Amount', format: 'amount', visible: { ifNotIn: [0] } };
  return {
    $schema: 'https://eips.ethereum.org/assets/eip-7730/erc7730-non-abi-dispatch.schema.json',
    context: { $id: `Uniswap Universal Router ${version}`, contract: { deployments: DEPLOYMENTS[version] } },
    metadata: { owner: 'Uniswap Labs', contractName: 'Universal Router', info: { url: 'https://uniswap.org/' } },
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

fs.mkdirSync('descriptors', { recursive: true });
for (const v of ['2.0', '2.1']) fs.writeFileSync(`descriptors/universal-router-${v}.json`, JSON.stringify(build(v), null, 2) + '\n');
