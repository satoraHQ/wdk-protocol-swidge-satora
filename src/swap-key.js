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

import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { HDKey } from '@scure/bip32'

import { SatoraInvalidOptionsError } from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

// Domain separator for the swap key: the derived key is unrelated to the
// account's own key beyond the one-way HMAC, and a different domain string
// would yield a different (independent) swap key.
const KEY_DOMAIN = 'satora-swap-key-v1'

// Fallback for accounts that do not expose their key pair: a deterministic
// signature over a fixed payload is used as the key material instead.
const KEY_MESSAGE = 'Satora swap key v1'
const KEY_TYPED_DATA = {
  domain: { name: 'Satora Swap Key', version: '1' },
  types: { SwapKey: [{ name: 'purpose', type: 'string' }] },
  primaryType: 'SwapKey',
  message: { purpose: KEY_DOMAIN }
}

/**
 * Derives the swap client's key material (a BIP32 xprv for the HTLC preimage /
 * claim keys) from the WDK wallet account, so the protocol never needs a
 * separate mnemonic. The derivation is deterministic: the same account always
 * yields the same swap key, which is what makes swaps recoverable across
 * restarts and devices.
 *
 * Key material, in order of preference:
 * 1. `account.keyPair.privateKey` — HMAC-SHA512 under a fixed domain (the
 *    swap key cannot be reversed into the account key).
 * 2. `account.sign(message)` over a fixed message (hardware / external
 *    signers). Requires a deterministic signature scheme (RFC 6979), which is
 *    what WDK's EVM and Bitcoin accounts use.
 * 3. `account.signTypedData(...)` over fixed EIP-712 data (raw EvmSigners).
 *
 * @param {IWalletAccount | Object} account - The wallet account.
 * @returns {Promise<string>} The base58check-encoded xprv.
 * @throws {SatoraInvalidOptionsError} If the account exposes no usable key material.
 */
export async function deriveSwapXprv (account) {
  const material = await keyMaterial(account)
  const seed = hmac(sha512, utf8(KEY_DOMAIN), material)
  return HDKey.fromMasterSeed(seed).privateExtendedKey
}

/**
 * @private
 * @param {Object} account - The wallet account.
 * @returns {Promise<Uint8Array>} The raw key material.
 */
async function keyMaterial (account) {
  const privateKey = readPrivateKey(account)
  if (privateKey) return privateKey

  if (typeof account?.sign === 'function') {
    return utf8(String(await account.sign(KEY_MESSAGE)))
  }

  if (typeof account?.signTypedData === 'function') {
    return utf8(String(await account.signTypedData(KEY_TYPED_DATA)))
  }

  throw new SatoraInvalidOptionsError(
    'the account cannot derive the swap key: it exposes neither keyPair, sign(message) nor signTypedData'
  )
}

/**
 * Reads the account's private key bytes, tolerating accounts whose `keyPair`
 * getter throws (e.g. seed-level or hardware signers).
 *
 * @private
 * @param {Object} account - The wallet account.
 * @returns {Uint8Array | undefined} The private key bytes, if exposed.
 */
function readPrivateKey (account) {
  let privateKey
  try {
    privateKey = account?.keyPair?.privateKey
  } catch {
    return undefined
  }
  if (privateKey == null) return undefined

  if (privateKey instanceof Uint8Array) return privateKey
  if (typeof privateKey === 'string') {
    const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
    if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return undefined
    return Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16))
  }
  return undefined
}

/**
 * @private
 * @param {string} text - The text to encode.
 * @returns {Uint8Array} The UTF-8 bytes.
 */
function utf8 (text) {
  return new TextEncoder().encode(text)
}
