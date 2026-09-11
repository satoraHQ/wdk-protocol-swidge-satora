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

import { SatoraInvalidOptionsError } from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */

/**
 * Metadata for each chain supported by the satora protocol, keyed by the
 * satora `Chain` identifier. Satora encodes EVM chains as numeric strings
 * ('1', '137', '42161') and non-EVM chains as names ('Bitcoin', 'Lightning',
 * 'Arkade'). Object keys are strings, so numeric ids are looked up by their
 * string form (e.g. `CHAIN_METADATA['137']`).
 *
 * @type {Record<string, SwidgeSupportedChain>}
 */
export const CHAIN_METADATA = {
  Bitcoin: { id: 'Bitcoin', name: 'Bitcoin', type: 'utxo', nativeToken: 'BTC' },
  Lightning: { id: 'Lightning', name: 'Lightning Network', type: 'lightning', nativeToken: 'BTC' },
  Arkade: { id: 'Arkade', name: 'Arkade', type: 'ark', nativeToken: 'BTC' },
  1: { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
  137: { id: 137, name: 'Polygon', type: 'evm', nativeToken: 'POL' },
  42161: { id: 42161, name: 'Arbitrum', type: 'evm', nativeToken: 'ETH' }
}

const NAMED_CHAINS = { bitcoin: 'Bitcoin', btc: 'Bitcoin', lightning: 'Lightning', arkade: 'Arkade' }

/**
 * Normalizes a caller-supplied chain reference to the satora `Chain`
 * identifier: EVM chains become their numeric id as a string ('42161'), the
 * Bitcoin-family chains their canonical name ('Bitcoin', 'Arkade',
 * 'Lightning'). Accepts numbers, numeric strings and case-insensitive names.
 *
 * @param {string | number} chain - The chain reference.
 * @returns {string} The satora chain identifier.
 * @throws {SatoraInvalidOptionsError} If the chain is not recognised.
 */
export function normalizeChain (chain) {
  const text = String(chain).trim()
  if (text !== '' && Number.isInteger(Number(text))) return String(Number(text))

  const named = NAMED_CHAINS[text.toLowerCase()]
  if (named) return named

  throw new SatoraInvalidOptionsError(
    `unknown chain "${chain}"; expected an EVM chain id (e.g. 42161) or "Bitcoin", "Arkade", "Lightning"`
  )
}

/**
 * Returns true if the chain identifier is an EVM chain (a numeric id).
 *
 * @param {string | number} chain - The chain identifier.
 * @returns {boolean}
 */
export function isEvmChain (chain) {
  return Number.isInteger(Number(chain))
}

/**
 * Normalizes a satora `Chain` identifier to the WDK chain id form: EVM chains
 * (encoded as numeric strings) become numbers, non-EVM chains stay as their
 * name. This is the canonical id surfaced by {@link toSupportedChain} and used
 * for `chain` fields and route-scoped filtering.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {string | number} The normalized chain id.
 */
export function toChainId (sdkChain) {
  const asNumber = Number(sdkChain)
  return Number.isInteger(asNumber) ? asNumber : String(sdkChain)
}

/**
 * Maps a satora `Chain` identifier to a WDK {@link SwidgeSupportedChain}.
 * Unknown identifiers fall back to a best-effort mapping: numeric ids are
 * treated as EVM chains, everything else as 'other'.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {SwidgeSupportedChain} The WDK supported-chain descriptor.
 */
export function toSupportedChain (sdkChain) {
  const meta = CHAIN_METADATA[sdkChain]
  if (meta) return { ...meta }

  const id = toChainId(sdkChain)
  const isEvm = typeof id === 'number'
  return {
    id,
    name: String(sdkChain),
    type: isEvm ? 'evm' : 'other',
    nativeToken: isEvm ? 'ETH' : 'BTC'
  }
}
