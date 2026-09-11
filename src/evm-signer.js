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

/** @typedef {import('@satora/swap').EvmSigner} EvmSigner */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/**
 * @typedef {(method: string, params: unknown[]) => Promise<any>} JsonRpc
 */

/**
 * Returns true if the object already implements the satora SDK's
 * {@link EvmSigner} contract (a viem/ethers-backed signer built by the caller).
 *
 * @param {Object} account - The account.
 * @returns {boolean}
 */
export function isEvmSigner (account) {
  return typeof account?.address === 'string' &&
    typeof account.signTypedData === 'function' &&
    typeof account.sendTransaction === 'function' &&
    typeof account.call === 'function' &&
    typeof account.waitForReceipt === 'function'
}

/**
 * Detects the EVM chain id the account is connected to: an {@link EvmSigner}
 * carries it as `chainId`; a WDK EVM account is asked through its provider
 * (`eth_chainId`). Returns undefined for non-EVM accounts.
 *
 * @param {Object} account - The account.
 * @returns {Promise<number | undefined>} The chain id, if detectable.
 */
export async function detectEvmChainId (account) {
  if (typeof account?.chainId === 'number') return account.chainId

  const rpc = jsonRpcOf(account)
  if (!rpc) return undefined

  try {
    return Number.parseInt(await rpc('eth_chainId', []), 16)
  } catch {
    return undefined
  }
}

/**
 * Adapts a WDK EVM wallet account (`@tetherto/wdk-wallet-evm`, including its
 * ERC-4337 variant) to the satora SDK's {@link EvmSigner}, so the account
 * itself signs and sends the HTLC funding / refund transactions. Signing goes
 * through the account (`signTypedData`, `sendTransaction`); reads go through
 * the account's provider via JSON-RPC. An object that already is an
 * {@link EvmSigner} is returned as is.
 *
 * @param {IWalletAccount | EvmSigner | Object} account - The wallet account.
 * @param {number} chainId - The chain the account operates on.
 * @returns {Promise<EvmSigner>} The signer.
 * @throws {SatoraInvalidOptionsError} If the account cannot sign EVM transactions or has no provider.
 */
export async function toEvmSigner (account, chainId) {
  if (isEvmSigner(account)) return account

  if (typeof account?.getAddress !== 'function' ||
      typeof account.signTypedData !== 'function' ||
      typeof account.sendTransaction !== 'function') {
    throw new SatoraInvalidOptionsError(
      'an EVM source requires a WDK EVM wallet account (getAddress, signTypedData, sendTransaction) or an EvmSigner'
    )
  }

  const rpc = jsonRpcOf(account)
  if (!rpc) {
    throw new SatoraInvalidOptionsError('the EVM wallet account must be connected to a provider')
  }

  const address = await account.getAddress()

  return {
    address,
    chainId,

    signTypedData: ({ domain, types, message }) => {
      // ethers (WDK's EVM signer) derives the domain type itself and rejects
      // an explicit EIP712Domain entry.
      const { EIP712Domain, ...rest } = types
      return account.signTypedData({ domain, types: rest, message })
    },

    sendTransaction: async ({ to, data, gas }) => {
      const tx = { to, data, value: 0n }
      if (gas !== undefined) tx.gasLimit = gas
      const { hash } = await account.sendTransaction(tx)
      return hash
    },

    waitForReceipt: (hash) => waitForReceipt(rpc, hash),

    getTransaction: async (hash) => {
      const tx = await rpc('eth_getTransactionByHash', [hash])
      if (!tx) throw new Error(`transaction ${hash} not found`)
      return { to: tx.to ?? null, input: tx.input, from: tx.from }
    },

    call: ({ to, data, from, blockNumber }) => {
      const call = { to, data }
      if (from !== undefined) call.from = from
      return rpc('eth_call', [call, blockNumber !== undefined ? `0x${blockNumber.toString(16)}` : 'latest'])
    }
  }
}

/**
 * Resolves a JSON-RPC transport for a WDK EVM account: its ethers provider
 * when connected, else the configured RPC URL or EIP-1193 provider.
 *
 * @private
 * @param {Object} account - The account.
 * @returns {JsonRpc | undefined} The transport, if any.
 */
function jsonRpcOf (account) {
  const provider = account?._provider
  if (provider && typeof provider.send === 'function') {
    return (method, params) => provider.send(method, params)
  }

  const configured = account?._config?.provider
  const first = Array.isArray(configured) ? configured[0] : configured
  if (typeof first === 'string') {
    return (method, params) => jsonRpcFetch(first, method, params)
  }
  if (first && typeof first.request === 'function') {
    return (method, params) => first.request({ method, params })
  }

  return undefined
}

/**
 * @private
 * @param {string} url - The RPC endpoint.
 * @param {string} method - The JSON-RPC method.
 * @param {unknown[]} params - The JSON-RPC params.
 * @returns {Promise<any>} The result.
 */
async function jsonRpcFetch (url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(`${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`)
  return body.result
}

/**
 * Polls for a transaction receipt.
 *
 * @private
 * @param {JsonRpc} rpc - The transport.
 * @param {string} hash - The transaction hash.
 * @param {{ timeoutMs?: number, intervalMs?: number }} [options] - Polling overrides.
 * @returns {Promise<import('@satora/swap').TxReceipt>} The receipt.
 */
async function waitForReceipt (rpc, hash, { timeoutMs = 600000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs

  while (true) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash])
    if (receipt) {
      return {
        status: receipt.status === '0x1' || receipt.status === 1 ? 'success' : 'reverted',
        blockNumber: BigInt(receipt.blockNumber),
        transactionHash: receipt.transactionHash ?? hash
      }
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for the receipt of ${hash}`)
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
