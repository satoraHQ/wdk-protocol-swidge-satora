# Examples

`satora-cli.js` is a small manual sample for exercising `SatoraProtocol`
against a live Satora deployment. It constructs the protocol exactly like a
real consumer would, so it doubles as living documentation.

All commands are **read-only** (discovery and quotes) — no account, mnemonic,
API key, or build step is required, and no funds are moved. By default it hits
production (`https://api.satora.io/`).

Run everything from the module root:

```bash
node examples/satora-cli.js <command> [options]
```

## Commands

### `chains` — list supported chains

```bash
node examples/satora-cli.js chains
```

EVM chains are shown with numeric ids (`1`, `137`, `42161`); Bitcoin-family
chains by name (`Bitcoin`, `Lightning`, `Arkade`).

### `tokens` — list supported tokens

```bash
node examples/satora-cli.js tokens

# optionally filter by chain
node examples/satora-cli.js tokens --to-chain 42161
node examples/satora-cli.js tokens --from-chain Bitcoin
```

The first two columns are the **chain** and the **token id** — the provider id
you pass as `--from`/`--to` (`btc`, or an ERC-20 contract address such as
`0xfd08…`) together with `--from-chain`/`--to-chain`. `btc` exists on three
chains (`Bitcoin`, `Lightning`, `Arkade`), which is why the chain travels
separately. The `decimals` column tells you the base unit for amounts.

### `quote` — quote a swidge

Pass the token ids, their chains, and one amount. (There is no account here,
so the source chain is declared with `--from-chain`; with a wallet account the
protocol takes it from the account.)

```bash
# exact-in: spend 0.001 BTC, receive Arbitrum USDT0
node examples/satora-cli.js quote \
  --from btc --from-chain Bitcoin \
  --to 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain 42161 \
  --amount 0.001

# exact-out: receive exactly 10 USDT0, pay from BTC
node examples/satora-cli.js quote \
  --from btc --from-chain Bitcoin \
  --to 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain 42161 \
  --out-amount 10
```

A chain-qualified `chain:token` (e.g. `Lightning:btc`) is accepted as well.

Amounts are in **decimal token units** — `--amount` in the source token
(e.g. `0.001` BTC), `--out-amount` in the destination token (e.g. `10` USDT0).
Use `--amount` for exact-in (source amount) or `--out-amount` for exact-out
(destination amount).

The quote is printed in **decimal token units**:

```
Quote:
  spend:   0.001 BTC  (btc on Bitcoin)
  receive: 58.71538 USDT0 (min 58.71538)  (0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 on 42161)
  fees:
    protocol 0.0000025 btc  Protocol fee (rate 0.0025)
    network  0.00000179 btc  Network fee (HTLC create/claim + BTC mining)
```

## Typical flow

```bash
# 1. find a token id
node examples/satora-cli.js tokens --to-chain 42161

# 2. quote against it
node examples/satora-cli.js quote --from btc --from-chain Bitcoin --to 0xfd08… --to-chain 42161 --amount 0.001
```

## Options

| Option              | Applies to | Description                                                  |
| ------------------- | ---------- | ------------------------------------------------------------ |
| `--base-url <url>`  | all        | Override the API base URL (or set `SATORA_BASE_URL`).        |
| `--from-chain <id>` | `tokens`   | Filter tokens by source chain.                               |
| `--to-chain <id>`   | `tokens`   | Filter tokens by destination chain.                          |
| `--from <token>`    | `quote`    | Source token id (contract address or `btc`).                 |
| `--from-chain <id>` | `quote`    | Source chain (`Bitcoin`, `Arkade`, `Lightning`, or an EVM id).|
| `--to <token>`      | `quote`    | Destination token id (contract address or `btc`).            |
| `--to-chain <id>`   | `quote`    | Destination chain (defaults to the source chain).            |
| `--amount <n>`      | `quote`    | Exact-in amount, in source token units (e.g. `0.001`).       |
| `--out-amount <n>`  | `quote`    | Exact-out amount, in destination token units (e.g. `10`).    |

Point at a non-production deployment with `--base-url` or `SATORA_BASE_URL`:

```bash
SATORA_BASE_URL=https://staging.satora.io/ node examples/satora-cli.js chains
```
