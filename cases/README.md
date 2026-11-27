# Cases

Calls to the Universal Router with what a careful wallet shows for each, or the fact that it refuses. They are data, so a reader written in any language can run them.

| File | Cases | What they are |
|---|---|---|
| `built-to-mislead.json` | 71 | Calls built by hand to mislead: output sent elsewhere, a fee taken after the swap, an address appended to a path, a bridge recipient that looks like a flag, a position permit for a stranger, a new position owned by the router, a command read differently by an older router. 30 of them must be refused. |
| `../registry-tests/*.tests.json` | 24 | Real Mainnet transactions, in the test format of the ERC-7730 registry. |

## Format of `built-to-mislead.json`

```
{
  "environment": {
    "chainId": 1,
    "sender": "0x1111…",                 // tx.from of every case
    "native": { "symbol": "ETH", "decimals": 18 },
    "tokens": { "<address>": { "symbol", "decimals" } },
    "tokensOnOtherChains": { "<chainId>:<address>": { "symbol", "decimals" } },
    "chainNames": { "<chainId>": "<name>" },
    "descriptorsOfCalledContracts": { "<address>": "<file>" },   // for the calls the router forwards
    "routers": { "1.0": "<address>", "1.2": "<address>", "2.0": "<address>", "2.1": "<address>" }
  },
  "cases": [
    { "name": "…", "router": "2.0", "tx": { "from", "to", "value", "input" }, "display": ["Label: value", …] },
    { "name": "…", "router": "2.1", "tx": { … }, "refused": true }
  ]
}
```

`router` says which descriptor applies. `display` is the list of fields in order, one `Label: value` per line, groups flattened. A case with `refused` has no display: the reader must show nothing of the call and say it cannot read it.

How values are written here:

- amounts in token units with trailing zeros removed, then the symbol; a token the environment does not know is shown as `(unknown token <address>)` with its raw amount;
- the sender as `You`, the router as `Uniswap router`, any other address as it is in the call;
- dates as `YYYY-MM-DD HH:MM UTC`;
- a chain by its name in `chainNames`, or `chain <id>`.

A reader that names things differently (an address book, another date format) should compare after mapping its own names to these.

## Run

```
node --test test.mjs   # rewrites built-to-mislead.json from the tests
node cases.mjs         # replays every file with reader.mjs
```
