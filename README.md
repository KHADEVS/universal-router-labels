# Labels for the Uniswap Universal Router

What a wallet should show when someone signs a Universal Router call, written as ERC-7730 descriptors in the syntax of the draft [Custom Encoding Layout](https://github.com/ethereum/ERCs/pull/1925) (read at `assets/erc-0000`, commit of 2026-10-19), and checked against real Mainnet transactions.

This is a proposal, not a registry entry: the draft is not merged, and no wallet supports it yet.

## Why

Most Uniswap swaps reach the chain as one call to a Universal Router: `execute(commands, inputs, deadline)`. The swap, its recipient, its minimum and its fees are packed inside `commands` and `inputs`, which are not plain ABI data. A wallet that reads ERC-7730 descriptors can show the deadline and the native amount, and nothing else. On a hardware wallet that means signing the swap blind, unless the vendor wrote a decoder of its own.

The Ethereum clear-signing working group is extending ERC-7730 for calls like this one. Its [notes of 11 November 2026](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3132) say that the Universal Routers can't be described until that extension merges, and that "the Uniswap labels still need an author: what the user actually reads". This repository is a first version of those labels, [offered to the group](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3286#issuecomment-7184389602) for its call of 9 December.

With them, a swap reads like this ([`0x39f46d43…`](https://etherscan.io/tx/0x39f46d432633bcb3d2c765269bebec88c660c2d6c8002c74f715971135d33980), router 2.1.2):

```
Uniswap trade
   Native Amount: 0.1833 ETH
   [Wrap]     Wrap: 0.1833 ETH · Recipient: Uniswap router
   [Swap]     Send: 0.1833 WETH · Minimum Output: 0 USDC · Recipient: Uniswap router · Paid by you: false
   [Fee]      Fee: 0.25% · Fee Token: USDC · Fee Recipient: 0xcD6b…9799
   [Collect]  Collect at Least: 303.471573 USDC · Recipient: You
   Valid Until: 2026-11-24 19:38 UTC
```

## What people sign

300 blocks, every 24th block of 2026-11-23 20:32 to 2026-11-24 20:30 UTC: 84,128 transactions, of which 1,994 (2.4%) call a Universal Router directly.

| | all 1,994 | the 681 with a price limit |
|---|---|---|
| contain a v4 swap | 93.2% | 80.6% |
| contain a v3 swap | 6.5% | 18.9% |
| contain a v2 swap | 3.1% | 9.1% |
| sent to router 2.0 / 2.1.1 / 2.1.2 | 78 / 1 / 21% | 52 / 3 / 45% |
| covered by the two commands of the draft's example | 0.7% | 1.9% |
| covered by the eight commands of its fuller rewrite ([forshtat/ERCs#14](https://github.com/forshtat/ERCs/pull/14)) | 6.0% | 17.5% |
| covered here | 100% | 100% |

1,313 of the 1,994 set no limit at all on what they receive. That suggests automated senders, so the second column is the one to read for people. One day of Mainnet only, direct calls only.

14 commands and 9 v4 actions were enough for the whole sample.

### Other chains

The same descriptors, built with each chain's own position managers, on calls sampled over the same 24 hours:

| chain | blocks | router calls | on 2.0 / 2.1+ | rendered |
|---|---|---|---|---|
| Unichain | 5,000 | 963 | 951 / 12 | 963 |
| Base | 3,000 | 456 | 423 / 33 | 456 |
| BNB Chain | 1,500 | 262 | 223 / 39 | 262 |
| Arbitrum | 12,000 | 68 | 24 / 44 | 68 |
| Polygon | 1,488 | 55 | 10 / 45 | 55 |
| Optimism | 2,000 | 5 | 2 / 3 | 5 |

1,809 of 1,809. One of them creates a v4 position through the router (command `0x14`). 22 more calls went to routers older than 2.0 (17 on Polygon, 5 on BNB Chain), which have another command table and no descriptor here. Block counts differ because block times do; these samples are small.

### Commands

Described: the two v2 and two v3 swaps, `V4_SWAP` with its 9 actions, Permit2 permits and transfers (single and batch), `SWEEP`, `TRANSFER`, both fee portions, wrap and unwrap, the balance check, pool creation, sub-plans, and on 2.1+ `executeSigned` and the Across deposit. The calls the router forwards to the position managers are shown with those contracts' own descriptors: the registry's for v3 (permit, then decreaseLiquidity, collect and burn), and `descriptors/v4-position-manager.json` for v4.

The v4 position manager needs more than the draft: `unlockData` is bytes that hold an ABI-encoded tuple, which takes the `abi` node of [forshtat/ERCs#14](https://github.com/forshtat/ERCs/pull/14). Its descriptor is written in that fuller syntax, and covers every action of `modifyLiquidities`, for direct calls too.

## Checks

- The two router descriptors are valid against the draft's schema, with its ten examples as a control. The position manager's is valid against the schema of the fuller draft.
- The 1,994 transactions render. The survey was decoded a second time with ethers.
- **Labels against receipts.** For the 681 transactions with a limit, 619 succeeded. In plans with a single swap, the token labelled as sent left the signer (259 of 259, never more than labelled) and the token labelled as received reached them (389 of 389, never less than labelled). ERC-20 legs only: native amounts are not in the logs. Three descriptors broken on purpose give 423, 56 and 9 differences.
- 41 tests with transactions built to mislead: an address appended to a packed path, output sent elsewhere, a 99% fee after the swap, a permit inside the plan, a hook, more commands than inputs, unknown commands, a recipient hidden in a sub-plan, a bridge deposit whose recipient is `0x…01`, a v3 position permit for someone other than the router, a v4 position whose owner is `0x…01`.
- `registry-tests/` holds 24 of the real transactions in the test format of the ERC-7730 registry (raw transaction, token data, expected display), valid against its schema, for the day a runner supports the extension.
- `cases/` holds the calls built to mislead as data: 53 cases, 17 of which must be refused, each with the call and what a careful wallet shows. With the 24 real transactions that is 77 cases a reader in any language can run ([format](cases/README.md)).

## What we learned

**1. Routers 2.0 and 2.1+ need separate descriptors.** 2.1 widened the command mask from `0x3f` to `0x7f` and added `minHopPriceX36` in the middle of the v4 tuples. Of the 33 calls with a v4 multi-hop swap sent to 2.1 routers, 30 are accepted by the 2.0 descriptor, all with wrong amounts, and 3 are refused. The other way round, all 50 are refused (`survey/wrong-version.mjs`). A test shows 1 ETH displayed as 0.00000000000000064 ETH. With the `0x3f` mask on a 2.1 router, command `0x40` (Across deposit) is read as a v3 swap.

**2. The token of a v4 amount depends on `zeroForOne`**, in 1,776 of the 1,994 transactions. A `switch` whose cases are `{format, params}` does it. The draft's schema accepts that form, its text does not mention it.

**3. "Minimum to Receive" is wrong on a swap that pays the router first.** A fee can be taken afterwards ([example](https://etherscan.io/tx/0xa1b169fea59f5385f271d64b04fcc2c7685effc2751cdf0c96c5d977a6db3cdd): swap minimum 247.36 USDT, the signer received 244.63). Here the swap says "Minimum Output", and "Minimum to Receive" is kept for steps that pay the user.

**4. Zero often means "everything".** 749 of 754 `TAKE` have amount 0 (all that is owed). Shown as is, that is "0 USDT". We hide it, for want of a special value ([wishlist item 7](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3181)).

**5. Recipient `0x…02` is the router itself**, in 121 transactions. `senderAddress` covers `0x…01`, nothing covers "this contract". The reader here prints "Uniswap router" by hand.

**6. A sub-plan is an `interaction` with the router itself:** `execute(commands, inputs)` called with the decoded values. It works, and it raises a question: inside an interaction, what are `@.value` and `@.from`? Here the inner call carries no value, and `0x…01` still means the signer.

**7. Points the draft leaves open:** what `$index` refers to inside a nested iteration (v4 actions inside commands), `.[-1]` on a decoded sequence, and what a wallet does when `commands` and `inputs` have different lengths (the router reverts, we refuse).

**8. A call the router forwards needs a file per chain, and a careful reader.** Commands `0x11`, `0x12` and `0x14` carry a whole call to a position manager, which ERC-7730's `calldata` format covers. Its `callee` is a constant, and the position managers differ from chain to chain, so the descriptors are built per chain (`build(version, chainId)` in `gen.mjs`; the two files here are Mainnet's). Inside that call the sender is the router: a reader that prints the signer as "you" has to keep that meaning when it goes one call down. The router checks that `0x11` is a permit, not who the permit is for, so the operator is what to read there. And in the v4 position manager `0x…01` is the caller: through the router, a position whose owner is `0x…01` belongs to the router, not to the signer.

**9. A token named without an amount cannot be the native currency.** `tokenAmount` has `nativeCurrencyAddress`; `tokenTicker` and `addressName` do not. In the position manager, `SETTLE_PAIR`, `TAKE_PAIR`, `CLOSE_CURRENCY` and `SWEEP` name a currency and no amount, so ETH is shown there as the zero address.

A packed v3 path decoded as `token | (fee | token)*` refuses the appended address of [registry#3136](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3136).

The wording of every label, command by command, is in [LABELS.md](LABELS.md).

## Run

```
npm ci
npm test                                  # descriptors, traps, the cases as data, the whole sample
node schema-check.mjs <ERCs>/assets/erc-0000 [<the same folder of forshtat/ERCs#14>]
node controls.mjs survey/sample.json survey/limited.json   # reads receipts from a public node
node registry-tests.mjs survey/sample.json survey/limited.json <registry>/specs/erc7730-tests-v2.schema.json
```

`gen.mjs` writes the descriptors, `labels.mjs` the table of labels, `reader.mjs` is the reader (about 150 lines, it refuses instead of guessing), `survey/` holds the sample and how it was taken.

## Not done

Routers older than 2.0, receipts on other chains, hardware screens, translation. The reader is for checking the labels, not for a wallet.

MIT licence.
