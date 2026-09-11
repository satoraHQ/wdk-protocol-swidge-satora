# @satora/wdk-protocol-swidge-satora

[![build](https://github.com/satoraHQ/wdk-protocol-swidge-satora/actions/workflows/build.yml/badge.svg)](https://github.com/satoraHQ/wdk-protocol-swidge-satora/actions/workflows/build.yml)
[![Built with WDK](assets/built-with-wdk.png)](https://github.com/tetherto/wdk)

A [WDK](https://github.com/tetherto/wdk) swidge protocol that performs
cross-chain atomic swaps via the [Satora](https://docs.satora.io/) protocol —
BTC (on-chain), Arkade, and Lightning on one side, EVM tokens on the other.

`SatoraProtocol` subclasses `SwidgeProtocol` from `@tetherto/wdk-wallet`, so it
plugs into WDK like any other swidge provider: hand it a WDK wallet account and
it signs, funds and claims with that account. No extra secrets.

## Installation

```bash
npm install @satora/wdk-protocol-swidge-satora
```

## Supported directions

The account you pass to the constructor is the **source** wallet; the
destination is always given as `options.recipient`.

| From ↓ / To →          | EVM | Arkade | Bitcoin | Lightning |
|------------------------|:---:|:------:|:-------:|:---------:|
| **EVM**                |  —  |   ✅    |    ✅    |     ✅     |
| **Arkade**             |  ✅  |   —    |    —    |     —     |
| **Bitcoin** (on-chain) |  ✅  |   —    |    —    |     —     |
| **Lightning**          |  ✅  |   —    |    —    |     —     |

## The account model

The protocol follows the WDK convention: the **account is the source wallet**,
and the source chain is the account's chain. `fromToken`/`toToken` are plain
provider token ids — an ERC-20 contract address, or `btc` — and `toChain` names
the destination chain for a cross-chain swidge.

| Account                                | Source chain                                | How it funds                                     |
|----------------------------------------|---------------------------------------------|--------------------------------------------------|
| `@tetherto/wdk-wallet-evm` (or ERC-4337) | detected from the account's provider         | `signTypedData` + `sendTransaction` (approve + HTLC deposit) |
| `@tetherto/wdk-wallet-btc`             | `chain: 'Bitcoin'`                           | `sendTransaction({ to, value })` to the HTLC     |
| `@tetherto/wdk-wallet-spark`           | detected (`payLightningInvoice`)             | pays the swap's BOLT11 invoice                   |
| Arkade wallet (`@arkade-os/sdk` adapter) | `chain: 'Arkade'`                            | `sendTransaction({ to, value })` to the VHTLC    |

Bitcoin and Arkade accounts look alike, so declare `config.chain` for them.

The swap client's own key material (the HTLC preimage and the claim/refund
key) is **derived from the account** — from its key pair, or from a
deterministic signature for external signers — so the same account always
recovers the same swaps. You never pass a mnemonic to the protocol.

An EVM account may also be a ready-made Satora `EvmSigner` (viem/ethers
backed); it is used as is.

## Configuration

```javascript
new SatoraProtocol(account, {
  chain,               // the account's chain: 42161 | 'Bitcoin' | 'Arkade' | 'Lightning' (detected for EVM/Lightning)
  signerStorage,       // WalletStorage — persists the swap key index (recommended)
  swapStorage,         // SwapStorage  — persists per-swap state (recovery/refund)
  defaultSlippage,     // decimal, e.g. 0.01 for 1%
  feeRateSatPerVb,     // on-chain fee rate for an EVM -> Bitcoin claim (default: SDK default)
  lightningMaxFeeSats, // max routing fee when a Lightning account pays the swap invoice
  baseUrl,             // Satora API base URL (defaults to production)
  arkadeServerUrl,     // Arkade server URL
  esploraUrl           // Esplora (Bitcoin) API URL
})
```

- **Read-only** operations (`getSupportedChains`, `getSupportedTokens`,
  `getSwidgeStatus`) need no account. `quoteSwidge` needs a source chain: from
  the account, `config.chain`, or a chain-qualified `fromToken`.
- **Fund-moving** operations (`swidge`, `resumeSwidge`, `refundSwidge`) need
  the account. Storage is **strongly recommended** and pluggable (`Sqlite*` in
  Node, IndexedDB in the browser) so an interrupted swap survives a restart and
  can be recovered with the same account.

## Token identifiers

Use the token's provider id: the ERC-20 contract address on EVM chains, `btc`
on the Bitcoin-family chains. `getSupportedTokens()` returns exactly these in
`token`, with the chain in `chain` (and `address` for EVM tokens):

```javascript
{ token: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', chain: 42161, symbol: 'USDT0', decimals: 6, ... }
{ token: 'btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, ... }
```

EVM chains use their numeric id (`1`, `137`, `42161`); Bitcoin-family chains
their name (`Bitcoin`, `Arkade`, `Lightning`). A chain-qualified
`chain:tokenId` (e.g. `Lightning:btc`, `42161:0xfd08…`) is also accepted on
either side and overrides `toChain`; it is handy for account-less quotes.

## Usage

### Discovery & quotes

```javascript
import SatoraProtocol from '@satora/wdk-protocol-swidge-satora'

const satora = new SatoraProtocol(undefined, { chain: 'Bitcoin' })

await satora.getSupportedChains()
await satora.getSupportedTokens({ toChain: 42161 })

const quote = await satora.quoteSwidge({
  fromToken: 'btc',
  toToken: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT0
  toChain: 42161,                                        // Arbitrum
  fromTokenAmount: 100000n                               // 0.001 BTC in sats
})
// quote.toTokenAmountMin is what the user agrees to — pass it to swidge as minAmountOut
```

### Executing a swap

`swidge` is **one-shot**: it creates the swap, funds the source with the
account, drives the claim, waits for settlement, and resolves with the
`SwidgeResult`. Pass `minAmountOut` (the `toTokenAmountMin` of the quote the
user accepted) and the swap is refused — before any funds move — if it would
deliver less.

```javascript
// EVM -> Arkade: a WDK EVM account on Arbitrum
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

const account = await new WalletManagerEvm(seed, { provider: 'https://arb1.arbitrum.io/rpc' }).getAccount(0)
const satora = new SatoraProtocol(account, { signerStorage, swapStorage })

const result = await satora.swidge({
  fromToken: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT0 on the account's chain
  toToken: 'btc',
  toChain: 'Arkade',
  fromTokenAmount: 1_500_000n,          // 1.5 USDT0
  recipient: 'ark1q…',                  // destination — the account is the source
  minAmountOut: quote.toTokenAmountMin
})
```

```javascript
// Arkade -> EVM: an Arkade wallet account (see examples/satora-cli-arkade.js)
const satora = new SatoraProtocol(arkadeAccount, { chain: 'Arkade', signerStorage, swapStorage })

await satora.swidge({
  fromToken: 'btc',
  toToken: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  toChain: 42161,
  fromTokenAmount: 100000n,
  recipient: '0xYourEvmAddress'
})
```

```javascript
// EVM -> Lightning: recipient is a BOLT11 invoice (the amount is carried by the invoice),
// a lightning address, or an LNURL (then toTokenAmount is the payout in sats)
await satora.swidge({ fromToken: '0xfd08…', toToken: 'btc', toChain: 'Lightning', recipient: 'lnbc…' })
await satora.swidge({ fromToken: '0xfd08…', toToken: 'btc', toChain: 'Lightning', recipient: 'user@wallet.com', toTokenAmount: 1500n })
```

### Status, recovery, refunds

```javascript
await satora.getSwidgeStatus(result.id) // -> { status, transactions }

// Recover a swap interrupted after funding (same account + storage):
await satora.resumeSwidge(result.id)    // drive it to completion, or throw

// If it can't complete, reclaim the source funds:
await satora.refundSwidge(result.id)    // direction-aware
```

`refundSwidge` dispatches on the swap direction:

- **EVM source** — reclaims the EVM HTLC with the account, collaborative and
  gasless by default (the account signs an EIP-712 message; needs an EOA
  signature), or `{ manual: true }` for the timelock refund the account sends
  itself (works with ERC-4337 smart accounts too). Pays out the BTC-pegged
  HTLC token (tBTC/WBTC).
- **Arkade / Bitcoin source** — reclaims to the account's address.
- **Lightning source** — throws; the unpaid invoice simply expires.

## API

- `getSupportedChains()` → `SwidgeSupportedChain[]`
- `getSupportedTokens(options?)` → `SwidgeSupportedToken[]`
- `quoteSwidge(options)` → `SwidgeQuote`
- `swidge(options, config?)` → `SwidgeResult` (honours `minAmountOut`)
- `getSwidgeStatus(id, options?)` → `SwidgeStatusResult`
- `resumeSwidge(id, options?)` → completes a persisted swap (Satora extension)
- `refundSwidge(id, options?)` → reclaims a stuck swap (Satora extension)

The inherited `swap`/`quoteSwap`/`bridge`/`quoteBridge` delegate to
`swidge`/`quoteSwidge`.

Errors: `SatoraInvalidOptionsError` (bad options/config) and
`SatoraMinAmountOutError` (the swap would deliver less than `minAmountOut`;
nothing was funded).

## Examples

Runnable CLIs live in [`examples/`](./examples) — one per wallet type, all
sharing a single seed via `examples/.env` (copy from `examples/.env.example`):

| CLI                    | Wallet                               | Directions                         |
|------------------------|--------------------------------------|------------------------------------|
| `satora-cli.js`        | none (read-only)                     | chains / tokens / quote            |
| `satora-cli-arkade.js` | Arkade (`@arkade-os/sdk` adapter)    | Arkade → EVM                       |
| `satora-cli-evm.js`    | `@tetherto/wdk-wallet-evm`           | EVM → Arkade / Bitcoin / Lightning |
| `satora-cli-spark.js`  | `@tetherto/wdk-wallet-spark`         | Lightning → EVM                    |
| `satora-cli-btc.js`    | `@tetherto/wdk-wallet-btc`           | Bitcoin → EVM                      |

```bash
node examples/satora-cli.js tokens --to-chain 42161
node --env-file=examples/.env examples/satora-cli-arkade.js swap \
  --to 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain 42161 --recipient 0x... --amount 0.0001
```

## Development

```bash
npm install
npm test              # unit tests (jest, mocked SDK)
npm run lint

# live read-only tests against production (opt-in)
SATORA_INTEGRATION=1 npm run test:integration
```

## License

Apache-2.0
