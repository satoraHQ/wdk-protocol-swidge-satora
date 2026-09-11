#!/usr/bin/env node
// Copyright 2026 bonomat <philipp@lendasat.com>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// End-to-end EVM -> Arkade / Bitcoin / Lightning swidge example. This MOVES
// REAL FUNDS.
//
// It derives a WDK EVM wallet account (@tetherto/wdk-wallet-evm) from a
// persistent BIP-39 seed and hands it to SatoraProtocol. The account is the
// source: it signs the Permit2 funding, sends the HTLC deposit (so it needs a
// little native gas), and also provides the swap client's key material — no
// separate secret. The source chain is read from the account's provider.
//
// Configure via the shared examples/.env (see examples/.env.example), loaded
// with --env-file:
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # the wallet seed (shared by all examples)
//   SATORA_EVM_RPC=https://arb1.arbitrum.io/rpc      # RPC for the source chain (optional)
//   SATORA_ARKADE_SERVER, SATORA_ESPLORA, SATORA_DB, SATORA_BASE_URL  # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-evm.js address
//   node --env-file=examples/.env examples/satora-cli-evm.js balance
//   # EVM -> Arkade (default destination)
//   node --env-file=examples/.env examples/satora-cli-evm.js swap \
//     --from 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --recipient ark1q... --amount 1.5
//   # EVM -> Bitcoin (on-chain; recipient is a BTC address)
//   node --env-file=examples/.env examples/satora-cli-evm.js swap \
//     --from 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --to-chain Bitcoin --recipient bc1q... --amount 1.5 --fee-rate 5
//   # EVM -> Lightning (recipient is a BOLT11 invoice, e.g. from satora-cli-spark.js invoice)
//   node --env-file=examples/.env examples/satora-cli-evm.js swap \
//     --from 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain Lightning --recipient lnbc...
//   node --env-file=examples/.env examples/satora-cli-evm.js status <swap-id>
//   node --env-file=examples/.env examples/satora-cli-evm.js resume <swap-id>

import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

import SatoraProtocol from '../index.js'

// Public RPC per chain, used unless SATORA_EVM_RPC is set.
const DEFAULT_RPC = {
  1: 'https://ethereum-rpc.publicnode.com',
  137: 'https://polygon-bor-rpc.publicnode.com',
  42161: 'https://arb1.arbitrum.io/rpc'
}

// USDT0 token address per chain, for the `balance` command.
const USDT0_BY_CHAIN = { 42161: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' }

function parseArgs (argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else { flags[key] = next; i++ }
  }
  return flags
}

function requireEnv (name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var ${name} (see examples/.env.example)`)
  return value
}

// Parses a decimal token amount into a base-unit bigint (e.g. "1.5" @ 6 -> 1500000n).
function parseUnits (value, decimals) {
  const [whole, fraction = ''] = String(value).trim().split('.')
  if (fraction.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimal places`)
  return BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`)
}

// Formats a base-unit bigint as a decimal string.
function formatUnits (amount, decimals) {
  const base = 10n ** BigInt(decimals)
  const whole = (BigInt(amount) / base).toString()
  const fraction = (BigInt(amount) % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

// Persistent SQLite storage; fail loudly if unavailable (see satora-cli-arkade.js).
async function createStorage (dbPath) {
  try {
    const { SqliteWalletStorage, SqliteSwapStorage } = await import('@satora/swap/node')
    return { signerStorage: new SqliteWalletStorage(dbPath), swapStorage: new SqliteSwapStorage(dbPath) }
  } catch (err) {
    throw new Error(
      `persistent SQLite storage is unavailable (${err.message.split('\n')[0]}). ` +
      'It is required so an interrupted swap can be recovered — refusing to run with ephemeral storage. ' +
      'Build the native addon with: (cd node_modules/better-sqlite3 && npx node-gyp rebuild)'
    )
  }
}

// Derives the WDK EVM wallet account (index 0) for the given chain.
async function buildEvmAccount (mnemonic, chainId) {
  const provider = process.env.SATORA_EVM_RPC || DEFAULT_RPC[chainId]
  if (!provider) throw new Error(`no RPC known for chain ${chainId}; set SATORA_EVM_RPC`)

  const manager = new WalletManagerEvm(mnemonic, { provider, chainId })
  return manager.getAccount(0)
}

async function createProtocol (account, { dbPath, feeRateSatPerVb }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    // The source chain is detected from the account's provider.
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
    esploraUrl: process.env.SATORA_ESPLORA || 'https://mempool.space/api',
    ...(feeRateSatPerVb ? { feeRateSatPerVb } : {}),
    ...(process.env.SATORA_BASE_URL ? { baseUrl: process.env.SATORA_BASE_URL } : {}),
    signerStorage,
    swapStorage
  })
}

function printResult (result) {
  console.log('status:', result.status ?? 'completed')
  if (result.message) console.log('note:  ', result.message)
  for (const tx of result.transactions ?? []) {
    console.log(`  ${tx.type} tx${tx.chain ? ` (${tx.chain})` : ''}: ${tx.hash}`)
  }
}

function usage () {
  console.log(`satora-cli-evm — EVM -> Arkade / Bitcoin / Lightning swidge example (WDK EVM wallet)

Usage:
  node --env-file=examples/.env examples/satora-cli-evm.js <command> [options]

Commands:
  address           Show the EVM wallet address (--chain <id>, default 42161)
  balance           Show native + USDT0 balance (--chain <id>, --token <address>)
  swap              Perform an EVM -> Arkade / Bitcoin / Lightning swap:
                      --from <address>        source ERC-20 contract address on the account's chain
                      --chain <id>            source EVM chain (default 42161)
                      --to-chain <chain>      Arkade (default), Bitcoin, or Lightning
                      --recipient <address>   Arkade/Bitcoin address, or a BOLT11 invoice for Lightning
                      --amount <units>        source-token units (Arkade/Bitcoin; Lightning uses the invoice)
                      --slippage <decimal>    max slippage vs the quote (default 0.01); sets minAmountOut
                      --fee-rate <sat/vB>     on-chain Bitcoin claim fee rate (Bitcoin only; or SATORA_BTC_FEE_RATE)
  status <swap-id>  Show the status of a swap by id
  resume <swap-id>  Drive an interrupted swap to completion (throws if it cannot)
  refund <swap-id>  Reclaim an EVM-sourced swap that cannot complete
                      --chain <id>            EVM chain (default 42161)
                      --manual                timelock refund (default: gasless collaborative)

The EVM wallet needs the source token plus a little native gas.
Config comes from examples/.env (copy from examples/.env.example).`)
}

async function main () {
  const argv = process.argv.slice(2)
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined
  const flags = parseArgs(argv)

  if (!command || command === 'help' || flags.help) {
    usage()
    process.exit(command && command !== 'help' ? 1 : 0)
  }

  const mnemonic = requireEnv('SATORA_MNEMONIC')
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('SATORA_MNEMONIC is not a valid BIP-39 mnemonic')
  }

  const dbPath = process.env.SATORA_DB || './.satora.db'
  const chainId = Number(flags.chain || 42161)
  const feeRateSatPerVb = flags['fee-rate'] !== undefined && flags['fee-rate'] !== true
    ? Number(flags['fee-rate'])
    : (process.env.SATORA_BTC_FEE_RATE ? Number(process.env.SATORA_BTC_FEE_RATE) : undefined)

  // status is read-only — no account needed.
  if (command === 'status') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('status requires a swap id: status <swap-id>')
      process.exit(1)
    }
    const protocol = await createProtocol(undefined, { dbPath, feeRateSatPerVb })
    printResult(await protocol.getSwidgeStatus(swapId))
    process.exit(0)
  }

  const account = await buildEvmAccount(mnemonic, chainId)
  const address = await account.getAddress()

  if (command === 'address') {
    console.log('EVM wallet:', address, `(chain ${chainId})`)
    process.exit(0)
  }

  if (command === 'balance') {
    const tokenAddress = flags.token || USDT0_BY_CHAIN[chainId]
    console.log('EVM wallet:', address, `(chain ${chainId})`)
    console.log(`  native: ${formatUnits(await account.getBalance(), 18)}`)

    if (tokenAddress) {
      const protocol = await createProtocol(account, { dbPath })
      const info = (await protocol.getSupportedTokens({ fromChain: chainId }))
        .find(t => t.token.toLowerCase() === tokenAddress.toLowerCase())
      const balance = await account.getTokenBalance(tokenAddress)
      console.log(`  ${info?.symbol ?? 'token'}: ${info ? formatUnits(balance, info.decimals) : `${balance} (base units)`} (${tokenAddress})`)
    } else {
      console.log(`  (no USDT0 known for chain ${chainId}; pass --token <address>)`)
    }
    process.exit(0)
  }

  // resume/refund reuse the account: the swap key is derived from it.
  if (command === 'resume' || command === 'refund') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error(`${command} requires a swap id: ${command} <swap-id> [--chain <id>]`)
      process.exit(1)
    }
    const protocol = await createProtocol(account, { dbPath, feeRateSatPerVb })

    if (command === 'resume') {
      console.log(`Resuming swap ${swapId} (driving it to completion) ...`)
      printResult(await protocol.resumeSwidge(swapId))
    } else {
      console.log(`Refunding swap ${swapId} to ${address} ...`)
      printResult(await protocol.refundSwidge(swapId, { ...(flags.manual ? { manual: true } : {}) }))
    }
    process.exit(0)
  }

  if (command !== 'swap') {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  if (!flags.from || !flags.recipient) {
    console.error('swap requires: --from <token-address> --recipient <address|invoice> [--to-chain <chain>] [--amount <units>]')
    process.exit(1)
  }

  const toChain = flags['to-chain'] || 'Arkade'
  const toLightning = String(toChain).toLowerCase() === 'lightning'
  const protocol = await createProtocol(account, { dbPath, feeRateSatPerVb })

  const info = (await protocol.getSupportedTokens({ fromChain: chainId }))
    .find(t => t.token.toLowerCase() === flags.from.toLowerCase())
  if (!info) throw new Error(`unknown token ${flags.from} on chain ${chainId} — run: node examples/satora-cli.js tokens --from-chain ${chainId}`)

  // Use the canonical token id (normalises the address case).
  const swapOptions = { fromToken: info.token, toToken: 'btc', toChain, recipient: flags.recipient }
  if (toLightning) {
    // EVM -> Lightning: the recipient is a BOLT11 invoice that carries the amount.
    if (!flags.recipient.toLowerCase().startsWith('ln')) {
      console.error('swap to Lightning requires --recipient to be a BOLT11 invoice (lnbc...)')
      process.exit(1)
    }
  } else {
    // EVM -> Arkade / Bitcoin: exact-in, amount in source-token units. Quote
    // first and pass the accepted minimum as the minAmountOut guard.
    if (flags.amount === undefined || flags.amount === true) {
      console.error(`swap to ${toChain} requires --amount <${info.symbol} units>`)
      process.exit(1)
    }
    swapOptions.fromTokenAmount = parseUnits(flags.amount, info.decimals)
    swapOptions.slippage = Number(flags.slippage || 0.01)

    const quote = await protocol.quoteSwidge(swapOptions)
    console.log(`Quote: ${formatUnits(quote.fromTokenAmount, info.decimals)} ${info.symbol} -> ${quote.toTokenAmount} sats (min ${quote.toTokenAmountMin})`)
    swapOptions.minAmountOut = quote.toTokenAmountMin
  }

  console.log('EVM wallet:', address, `(chain ${chainId})`)
  console.log(`\nSwapping ${flags.amount ?? '(invoice amount)'} ${info.symbol} -> ${toChain} for ${flags.recipient} ...`)
  console.log('(this funds the EVM HTLC, then drives the whole flow — it can take a little while)\n')

  const result = await protocol.swidge(swapOptions)

  console.log('Done:')
  console.log('  swap id: ', result.id)
  console.log(`  spent:   ${formatUnits(result.fromTokenAmount, info.decimals)} ${info.symbol}`)
  console.log('  received:', result.toTokenAmount, 'sats')
  for (const tx of result.transactions) console.log(`  ${tx.type} tx (${tx.chain}): ${tx.hash}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
