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

'use strict'

import { toChainId } from './chains.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */

const SEPARATOR = ':'

/**
 * Splits a token identifier into its parts. The WDK convention is a bare
 * token id — an ERC-20 contract address, or `btc` — with the chain coming from
 * the account (source) or `toChain` (destination). A chain-qualified form
 * (`chain:tokenId`, e.g. `42161:0x...` or `Lightning:btc`) is also accepted
 * and yields `chain`; otherwise `chain` is undefined.
 *
 * @param {string} token - The token identifier (`tokenId` or `chain:tokenId`).
 * @returns {{ chain: string | undefined, tokenId: string }} The parts.
 */
export function parseTokenId (token) {
  const value = String(token).trim()
  const index = value.indexOf(SEPARATOR)
  if (index === -1) return { chain: undefined, tokenId: value }
  return { chain: value.slice(0, index), tokenId: value.slice(index + 1) }
}

/**
 * Maps a satora `TokenInfo` to a WDK {@link SwidgeSupportedToken}. `token` is
 * the bare provider token id (`btc`, or the ERC-20 contract address), which can
 * be passed straight back as `fromToken`/`toToken`; the chain is carried by
 * `chain`. For EVM tokens the contract address is also surfaced as `address`.
 *
 * @param {Object} info - The satora token info.
 * @param {string} info.token_id - The provider-specific token identifier.
 * @param {string | number} info.chain - The satora chain identifier.
 * @param {string} info.symbol - The token symbol.
 * @param {number} info.decimals - The token's base-unit decimals.
 * @param {string} info.name - The token's full name.
 * @returns {SwidgeSupportedToken} The WDK supported-token descriptor.
 */
export function toSupportedToken (info) {
  const isEvmAddress = typeof info.token_id === 'string' && info.token_id.startsWith('0x')

  const token = {
    token: info.token_id,
    chain: toChainId(info.chain),
    symbol: info.symbol,
    decimals: info.decimals,
    name: info.name
  }

  if (isEvmAddress) token.address = info.token_id

  return token
}
