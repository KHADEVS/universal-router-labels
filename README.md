# Labels for the Uniswap Universal Router

What a wallet should show when someone signs a Universal Router call, written as ERC-7730 descriptors in the syntax of the draft [Custom Encoding Layout](https://github.com/ethereum/ERCs/pull/1925) (read at `assets/erc-0000`, commit of 2026-10-19), and checked against real Mainnet transactions.

This is a proposal, not a registry entry: the draft is not merged, and no wallet supports it yet.

## What people sign

300 blocks, every 24th block of 2026-11-23 20:32 to 2026-11-24 20:30 UTC: 84,128 transactions, of which 1,994 (2.4%) call a Universal Router directly.

| | all 1,994 | the 681 with a price limit |
|---|---|---|
| contain a v4 swap | 93.2% | 80.6% |
| contain a v3 swap | 6.5% | 18.9% |
| contain a v2 swap | 3.1% | 9.1% |
| sent to router 2.0 / 2.1.1 / 2.1.2 | 78 / 1 / 21% | 52 / 3 / 45% |
| covered by the two commands of the draft's example | 0.7% | 1.9% |
| covered here | 100% | 100% |

1,313 of the 1,994 set no limit at all on what they receive. That suggests automated senders, so the second column is the one to read for people. One day of Mainnet only, direct calls only.

14 commands and 9 v4 actions were enough for the whole sample. The other commands are refused, including `EXECUTE_SUB_PLAN` (no use in the sample).

## Checks

- Both descriptors are valid against the draft's schema, with its ten examples as a control.
- The 1,994 transactions render. The survey was decoded a second time with ethers.
- **Labels against receipts.** For the 681 transactions with a limit, 619 succeeded. In plans with a single swap, the token labelled as sent left the signer (259 of 259, never more than labelled) and the token labelled as received reached them (389 of 389, never less than labelled). ERC-20 legs only: native amounts are not in the logs. Three descriptors broken on purpose give 423, 56 and 9 differences.
- 16 tests with transactions built to mislead: an address appended to a packed path, output sent elsewhere, a 99% fee after the swap, a permit inside the plan, a hook, more commands than inputs, unknown commands.

## What we learned

**1. Routers 2.0 and 2.1+ need separate descriptors.** 2.1 widened the command mask from `0x3f` to `0x7f` and added `minHopPriceX36` in the middle of the v4 tuples. Of the 33 calls with a v4 multi-hop swap sent to 2.1 routers, 30 are accepted by the 2.0 descriptor, all with wrong amounts, and 3 are refused. The other way round, all 50 are refused (`survey/wrong-version.mjs`). A test shows 1 ETH displayed as 0.00000000000000064 ETH. With the `0x3f` mask on a 2.1 router, command `0x40` (Across deposit) is read as a v3 swap.

**2. The token of a v4 amount depends on `zeroForOne`**, in 1,776 of the 1,994 transactions. A `switch` whose cases are `{format, params}` does it. The draft's schema accepts that form, its text does not mention it.

**3. "Minimum to Receive" is wrong on a swap that pays the router first.** A fee can be taken afterwards ([example](https://etherscan.io/tx/0xa1b169fea59f5385f271d64b04fcc2c7685effc2751cdf0c96c5d977a6db3cdd): swap minimum 247.36 USDT, the signer received 244.63). Here the swap says "Minimum Output", and "Minimum to Receive" is kept for steps that pay the user.

**4. Zero often means "everything".** 749 of 754 `TAKE` have amount 0 (all that is owed). Shown as is, that is "0 USDT". We hide it, for want of a special value ([wishlist item 7](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3181)).

**5. Recipient `0x…02` is the router itself**, in 121 transactions. `senderAddress` covers `0x…01`, nothing covers "this contract". The reader here prints "Uniswap router" by hand.

**6. Points the draft leaves open:** what `$index` refers to inside a nested iteration (v4 actions inside commands), `.[-1]` on a decoded sequence, and what a wallet does when `commands` and `inputs` have different lengths (the router reverts, we refuse).

A packed v3 path decoded as `token | (fee | token)*` refuses the appended address of [registry#3136](https://github.com/ethereum/clear-signing-erc7730-registry/issues/3136).

## A real example

[`0x39f46d43…`](https://etherscan.io/tx/0x39f46d432633bcb3d2c765269bebec88c660c2d6c8002c74f715971135d33980), router 2.1.2:

```
Uniswap trade
   Native Amount: 0.1833 ETH
   [Wrap]     Wrap: 0.1833 ETH · Recipient: Uniswap router
   [Swap]     Send: 0.1833 WETH · Minimum Output: 0 USDC · Recipient: Uniswap router · Paid by you: false
   [Fee]      Fee: 0.25% · Fee Token: USDC · Fee Recipient: 0xcD6b…9799
   [Collect]  Collect at Least: 303.471573 USDC · Recipient: You
   Valid Until: 2026-11-24 19:38 UTC
```

## Run

```
npm ci
npm test                                  # descriptors, traps, the whole sample
node schema-check.mjs <ERCs>/assets/erc-0000
node controls.mjs survey/sample.json survey/limited.json   # reads receipts from a public node
```

`gen.mjs` writes the descriptors, `reader.mjs` is the reader (about 150 lines, it refuses instead of guessing), `survey/` holds the sample and how it was taken.

## Not done

Other chains, `executeSigned`, position manager commands, hardware screens, translation. The reader is for checking the labels, not for a wallet.

MIT licence.
