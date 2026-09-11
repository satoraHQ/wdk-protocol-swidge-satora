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

// End-to-end Bitcoin (on-chain) -> EVM swidge example. This MOVES REAL FUNDS.
//
// It derives a WDK Bitcoin wallet account (@tetherto/wdk-wallet-btc, BIP-84
// native segwit) from a persistent BIP-39 seed and hands it to SatoraProtocol
// as the Bitcoin source. The account funds the on-chain HTLC and provides the
// swap client's key material; the EVM tokens are claimed to your recipient
// address. On-chain confirmations make this the slowest direction.
//
// The account talks to an Electrum server (or Blockbook). Configure via the
// shared examples/.env (see examples/.env.example):
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # the wallet seed (shared)
//   SATORA_BTC_ELECTRUM=electrum.blockstream.info:50002  # Electrum SSL server (optional)
//   SATORA_BTC_BLOCKBOOK=https://btc1.trezor.io/api      # or a Blockbook API (optional)
//   SATORA_BTC_FEE_RATE=2                              # sat/vB (optional)
//   SATORA_DB, SATORA_BASE_URL, SATORA_ESPLORA         # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-btc.js address
//   node --env-file=examples/.env examples/satora-cli-btc.js balance
//   node --env-file=examples/.env examples/satora-cli-btc.js send --to bc1q... --amount 5000
//   node --env-file=examples/.env examples/satora-cli-btc.js swap \
//     --to 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain 42161 \
//     --recipient 0xYourEvmAddress --amount 20000
//   node --env-file=examples/.env examples/satora-cli-btc.js status <swap-id>

import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'

import SatoraProtocol from '../index.js'

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

// The WDK Bitcoin client: a Blockbook API if configured, else an Electrum SSL server.
function btcClient () {
  if (process.env.SATORA_BTC_BLOCKBOOK) {
    return { type: 'blockbook-http', clientConfig: { url: process.env.SATORA_BTC_BLOCKBOOK } }
  }
  const [host, port = '50002'] = (process.env.SATORA_BTC_ELECTRUM || 'electrum.blockstream.info:50002').split(':')
  return { type: 'electrum', clientConfig: { host, port: Number(port), protocol: 'ssl' } }
}

// Derives the WDK Bitcoin wallet account (BIP-84, index 0).
async function buildBitcoinAccount (mnemonic) {
  const manager = new WalletManagerBtc(mnemonic, { client: btcClient(), bip: 84, network: 'bitcoin' })
  return manager.getAccount(0)
}

// Pins the fee rate the account uses when it funds the HTLC (swidge only
// passes { to, value }); everything else is inherited from the account.
function withFeeRate (account, feeRate) {
  if (!feeRate) return account
  const source = Object.create(account)
  source.sendTransaction = (tx) => account.sendTransaction({ ...tx, feeRate })
  return source
}

async function createProtocol (account, { dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    chain: 'Bitcoin', // a Bitcoin account cannot be told apart from an Arkade one
    esploraUrl: process.env.SATORA_ESPLORA || 'https://mempool.space/api',
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
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
  console.log(`satora-cli-btc — Bitcoin (on-chain) -> EVM swidge example (WDK Bitcoin wallet)

Usage:
  node --env-file=examples/.env examples/satora-cli-btc.js <command> [options]

Commands:
  address              Show the Bitcoin address (BIP-84 native segwit)
  balance              Show the on-chain balance (sats)
  send                 Send on-chain BTC:
                         --to <btc-address>      destination address
                         --amount <sats>         amount to send, in sats
                         --fee-rate <sat/vB>     optional (or SATORA_BTC_FEE_RATE)
  swap                 Perform a Bitcoin -> EVM swap:
                         --to <address>          destination ERC-20 contract address (e.g. 0xfd08...)
                         --to-chain <id>         destination EVM chain (default 42161)
                         --recipient <address>   EVM address to receive the tokens
                         --amount <sats>         amount to send, in sats
                         --fee-rate <sat/vB>     optional funding-tx fee rate
  status <swap-id>     Show the status of a swap by id
  resume <swap-id>     Drive an interrupted swap to completion (throws if it cannot)

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

  // status is read-only — no account needed.
  if (command === 'status') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('status requires a swap id: status <swap-id>')
      process.exit(1)
    }
    const protocol = await createProtocol(undefined, { dbPath })
    printResult(await protocol.getSwidgeStatus(swapId))
    process.exit(0)
  }

  const feeRate = flags['fee-rate'] !== undefined && flags['fee-rate'] !== true
    ? Number(flags['fee-rate'])
    : (process.env.SATORA_BTC_FEE_RATE ? Number(process.env.SATORA_BTC_FEE_RATE) : undefined)

  const account = withFeeRate(await buildBitcoinAccount(mnemonic), feeRate)
  const address = await account.getAddress()

  if (command === 'address') {
    console.log('Bitcoin address:', address)
    process.exit(0)
  }

  if (command === 'balance') {
    console.log('Bitcoin address:', address)
    console.log('Balance:', await account.getBalance(), 'sats')
    process.exit(0)
  }

  if (command === 'send') {
    if (!flags.to || flags.amount === undefined || flags.amount === true) {
      console.error('send requires: --to <btc-address> --amount <sats>')
      process.exit(1)
    }
    console.log('Bitcoin address:', address)
    console.log(`Sending ${flags.amount} sats to ${flags.to} ...`)
    const { hash } = await account.sendTransaction({ to: flags.to, value: BigInt(flags.amount) })
    console.log('Sent. txid:', hash)
    process.exit(0)
  }

  if (command === 'resume') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('resume requires a swap id: resume <swap-id>')
      process.exit(1)
    }
    const protocol = await createProtocol(account, { dbPath })
    console.log(`Resuming swap ${swapId} (driving it to completion) ...`)
    printResult(await protocol.resumeSwidge(swapId))
    process.exit(0)
  }

  if (command !== 'swap') {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  if (!flags.to || !flags.recipient || flags.amount === undefined || flags.amount === true) {
    console.error('swap requires: --to <token-address> [--to-chain <id>] --recipient <evm-address> --amount <sats>')
    process.exit(1)
  }

  const toChain = Number(flags['to-chain'] || 42161)
  const protocol = await createProtocol(account, { dbPath })

  console.log('Bitcoin address:', address)
  console.log(`\nSwapping ${flags.amount} sats (Bitcoin) -> ${flags.to} on ${toChain} for ${flags.recipient} ...`)
  console.log('(funds the on-chain HTLC, then waits for confirmations — this is the slow one)\n')

  const result = await protocol.swidge({
    fromToken: 'btc',
    toToken: flags.to,
    toChain,
    fromTokenAmount: BigInt(flags.amount),
    recipient: flags.recipient
  })

  console.log('Done:')
  console.log('  swap id: ', result.id)
  console.log('  spent:   ', result.fromTokenAmount, 'sats')
  console.log('  received:', result.toTokenAmount, `(${flags.to} on ${toChain}, base units)`)
  for (const tx of result.transactions) console.log(`  ${tx.type} tx (${tx.chain}): ${tx.hash}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
