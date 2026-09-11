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

// A small manual sample for exercising the SatoraProtocol against a live
// satora deployment (production by default). It constructs the protocol
// exactly like a real consumer would, so it doubles as living documentation.
//
//   node examples/satora-cli.js chains
//   SATORA_BASE_URL=https://api.satora.io/ node examples/satora-cli.js chains
//
// More commands (tokens, quote, swidge, status) will land alongside the
// implementation of the corresponding protocol methods.

import SatoraProtocol from '../index.js'

function parseArgs (argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function createProtocol (flags, chain) {
  const baseUrl = flags['base-url'] || process.env.SATORA_BASE_URL
  const config = baseUrl ? { baseUrl } : {}
  // Without an account the source chain must be declared for quotes.
  if (chain !== undefined) config.chain = chain
  return new SatoraProtocol(undefined, config)
}

// Splits an optional chain-qualified token (`chain:tokenId`) into its parts.
function splitToken (value) {
  const text = String(value)
  const index = text.indexOf(':')
  return index === -1 ? { chain: undefined, token: text } : { chain: text.slice(0, index), token: text.slice(index + 1) }
}

async function chains (flags) {
  const protocol = createProtocol(flags)
  const supported = await protocol.getSupportedChains()

  console.log(`Supported chains (${supported.length}):\n`)
  for (const chain of supported) {
    console.log(
      `  ${String(chain.id).padEnd(10)} ${chain.name.padEnd(20)} ${chain.type.padEnd(10)} native: ${chain.nativeToken}`
    )
  }
}

async function tokens (flags) {
  const protocol = createProtocol(flags)
  const options = {}
  if (flags['from-chain'] !== undefined) options.fromChain = flags['from-chain']
  if (flags['to-chain'] !== undefined) options.toChain = flags['to-chain']

  const supported = await protocol.getSupportedTokens(options)

  console.log(`Supported tokens (${supported.length}):\n`)
  console.log(`  ${'chain'.padEnd(10)} ${'token'.padEnd(44)} ${'symbol'.padEnd(8)} decimals`)
  for (const token of supported) {
    // token.token is the provider id (contract address or btc) to pass to
    // `quote` as --from/--to, together with --from-chain/--to-chain.
    console.log(
      `  ${String(token.chain).padEnd(10)} ${token.token.padEnd(44)} ${token.symbol.padEnd(8)} ${String(token.decimals).padEnd(4)} ${token.name}`
    )
  }
}

// BTC (and its Lightning/Arkade variants) use 8 decimals; satora quotes fees in
// satoshis, denominated in BTC.
const BTC_DECIMALS = 8

// Formats a base-unit bigint as a decimal string with the given decimals.
function formatUnits (amount, decimals) {
  const value = BigInt(amount)
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString()
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

// Parses a decimal token amount into a base-unit bigint (e.g. "0.001" @ 8 -> 100000n).
function parseUnits (value, decimals) {
  const str = String(value).trim()
  const negative = str.startsWith('-')
  const [whole, fraction = ''] = (negative ? str.slice(1) : str).split('.')
  if (fraction.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places`)
  }
  const result = BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`)
  return negative ? -result : result
}

async function quote (flags) {
  if (!flags.from || !flags.to) throw new Error('quote requires --from <token> --from-chain <chain> --to <token> --to-chain <chain>')

  // Tokens are provider ids (contract address or btc); the chains come from
  // --from-chain / --to-chain. A chain-qualified `chain:token` is accepted too.
  const from = splitToken(flags.from)
  const to = splitToken(flags.to)
  const fromChain = from.chain ?? flags['from-chain']
  const toChain = to.chain ?? flags['to-chain'] ?? fromChain
  if (fromChain === undefined) throw new Error('quote requires --from-chain <chain> (or a chain-qualified --from)')

  const protocol = createProtocol(flags, fromChain)

  // Look up decimals up front: input amounts are given in decimal token units
  // and converted to base units, and the output is formatted the same way.
  const supported = await protocol.getSupportedTokens()
  const lookup = (chain, token) => supported.find(info =>
    String(info.chain).toLowerCase() === String(chain).toLowerCase() && info.token.toLowerCase() === token.toLowerCase()
  )
  const fromInfo = lookup(fromChain, from.token)
  const toInfo = lookup(toChain, to.token)
  if (!fromInfo) throw new Error(`unknown token "${from.token}" on ${fromChain} — run the "tokens" command to list valid ids`)
  if (!toInfo) throw new Error(`unknown token "${to.token}" on ${toChain} — run the "tokens" command to list valid ids`)

  const options = { fromToken: fromInfo.token, toToken: toInfo.token, toChain }
  if (flags.amount !== undefined) {
    options.fromTokenAmount = parseUnits(flags.amount, fromInfo.decimals)
  } else if (flags['out-amount'] !== undefined) {
    options.toTokenAmount = parseUnits(flags['out-amount'], toInfo.decimals)
  }

  const result = await protocol.quoteSwidge(options)

  const format = (amount, info) => `${formatUnits(amount, info.decimals)} ${info.symbol}`

  console.log('Quote:')
  console.log(`  spend:   ${format(result.fromTokenAmount, fromInfo)}  (${fromInfo.token} on ${fromChain})`)
  console.log(`  receive: ${format(result.toTokenAmount, toInfo)} (min ${formatUnits(result.toTokenAmountMin, toInfo.decimals)})  (${toInfo.token} on ${toChain})`)
  console.log('  fees:')
  for (const fee of result.fees) {
    const description = fee.description ? `  ${fee.description}` : ''
    console.log(`    ${fee.type.padEnd(8)} ${formatUnits(fee.amount, BTC_DECIMALS)} ${fee.token}${description}`)
  }
}

const COMMANDS = {
  chains,
  tokens,
  quote
}

function usage () {
  console.log(`satora-cli — manual sample for @satora/wdk-protocol-swidge-satora

Usage:
  node examples/satora-cli.js <command> [options]

Commands:
  chains            List the chains supported by the satora protocol
  tokens            List the tokens supported by the satora protocol
  quote             Quote a swidge, e.g.
                    --from btc --from-chain Bitcoin --to 0xfd08... --to-chain 42161 --amount 0.001

Options:
  --base-url <url>   Override the satora API base URL (or set SATORA_BASE_URL).
                     Defaults to the SDK's production endpoint.
  --from-chain <id>  Source-chain filter (tokens) / source chain (quote).
  --to-chain <id>    Dest-chain filter (tokens) / destination chain (quote).
  --from <token>     Source token id: contract address or btc (quote).
  --to <token>       Destination token id: contract address or btc (quote).
  --amount <n>       Exact-in amount in source token units, e.g. 0.001 (quote).
  --out-amount <n>   Exact-out amount in destination token units (quote).`)
}

async function main () {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional[0]

  if (!command || flags.help) {
    usage()
    process.exit(command ? 0 : 1)
  }

  const handler = COMMANDS[command]
  if (!handler) {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  await handler(flags)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
