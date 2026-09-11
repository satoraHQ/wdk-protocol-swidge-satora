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

// End-to-end Lightning -> EVM swidge example, using a WDK Spark wallet. MOVES
// REAL FUNDS.
//
// It derives a WDK Spark wallet account (@tetherto/wdk-wallet-spark) from a
// persistent BIP-39 seed and hands it to SatoraProtocol as the Lightning
// source. SatoraProtocol creates the swap, the account pays the returned
// BOLT11 invoice, and the EVM tokens are claimed to your recipient address.
// The account also provides the swap client's key material.
//
// Requires a FUNDED Spark wallet (Lightning-spendable sats). Configure via the
// shared examples/.env (see examples/.env.example), loaded with --env-file:
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # the wallet seed (shared)
//   SATORA_SPARK_MAX_FEE_SATS=100                     # max Lightning routing fee (optional)
//   SATORA_DB, SATORA_BASE_URL, SATORA_ARKADE_SERVER, SATORA_ESPLORA  # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-spark.js address
//   node --env-file=examples/.env examples/satora-cli-spark.js balance
//   node --env-file=examples/.env examples/satora-cli-spark.js invoice --amount 1000
//   node --env-file=examples/.env examples/satora-cli-spark.js pay --invoice lnbc...
//   node --env-file=examples/.env examples/satora-cli-spark.js swap \
//     --to 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --to-chain 42161 \
//     --recipient 0xYourEvmAddress --amount 5000

import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import WalletManagerSpark from '@tetherto/wdk-wallet-spark'

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

const maxFeeSats = () => Number(process.env.SATORA_SPARK_MAX_FEE_SATS || 100)

// Derives the WDK Spark wallet account (index 0).
async function buildSparkAccount (mnemonic) {
  const manager = new WalletManagerSpark(mnemonic, { network: 'MAINNET' })
  return manager.getAccount(0)
}

async function createProtocol (account, { dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    // The source chain (Lightning) is detected from the account.
    lightningMaxFeeSats: maxFeeSats(),
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
    esploraUrl: process.env.SATORA_ESPLORA || 'https://mempool.space/api',
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
  console.log(`satora-cli-spark — Lightning -> EVM swidge example (WDK Spark wallet)

Usage:
  node --env-file=examples/.env examples/satora-cli-spark.js <command> [options]

Commands:
  address              Show the Spark address
  balance              Show the spendable balance (sats)
  invoice --amount <n> Create a Lightning invoice for <n> sats (--memo optional)
  pay --invoice <b11>  Pay a BOLT11 Lightning invoice
  swap                 Perform a Lightning -> EVM swap:
                         --to <address>          destination ERC-20 contract address (e.g. 0xfd08...)
                         --to-chain <id>         destination EVM chain (default 42161)
                         --recipient <address>   EVM address to receive the tokens
                         --amount <sats>         amount to send, in sats
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

  // status is read-only — no wallet needed.
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

  const account = await buildSparkAccount(mnemonic)

  if (command === 'address') {
    console.log('Spark address:', await account.getAddress())
    process.exit(0)
  }

  if (command === 'balance') {
    console.log('Balance:', await account.getBalance(), 'sats')
    process.exit(0)
  }

  if (command === 'invoice') {
    if (flags.amount === undefined || flags.amount === true) {
      console.error('invoice requires: --amount <sats> [--memo <text>]')
      process.exit(1)
    }
    const request = await account.createLightningInvoice({
      amountSats: Number(flags.amount),
      ...(typeof flags.memo === 'string' ? { memo: flags.memo } : {})
    })
    console.log(request.invoice.encodedInvoice)
    process.exit(0)
  }

  if (command === 'pay') {
    if (!flags.invoice || flags.invoice === true) {
      console.error('pay requires: --invoice <bolt11>')
      process.exit(1)
    }
    console.log(`Paying invoice ${flags.invoice.slice(0, 30)}... `)
    const result = await account.payLightningInvoice({ invoice: flags.invoice, maxFeeSats: maxFeeSats() })
    console.log('Paid. status:', result.status ?? 'submitted')
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

  console.log('Spark address:', await account.getAddress())
  console.log(`\nSwapping ${flags.amount} sats (Lightning) -> ${flags.to} on ${toChain} for ${flags.recipient} ...`)
  console.log('(pays the swap invoice, then drives the whole flow — it can take a little while)\n')

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
