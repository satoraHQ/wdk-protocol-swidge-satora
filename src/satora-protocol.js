// Copyright 2026 bonomat &lt;philipp@lendasat.com&gt;
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

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { Client } from '@satora/swap'

import { isEvmChain, normalizeChain, toSupportedChain } from './chains.js'
import { parseTokenId, toSupportedToken } from './tokens.js'
import { SatoraInvalidOptionsError, SatoraMinAmountOutError } from './errors.js'
import { deriveSwapXprv } from './swap-key.js'
import { detectEvmChainId, toEvmSigner } from './evm-signer.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/** @typedef {import('@satora/swap').Client} SatoraClient */
/** @typedef {import('@satora/swap').EvmSigner} EvmSigner */
/** @typedef {import('@satora/swap').WalletStorage} WalletStorage */
/** @typedef {import('@satora/swap').SwapStorage} SwapStorage */
/** @typedef {import('@satora/swap').GetSwapResponse} GetSwapResponse */
/** @typedef {import('@satora/swap').RefundOptions} RefundOptions */
/** @typedef {import('@satora/swap').ClaimOptions} ClaimOptions */
/** @typedef {import('@satora/swap').QuoteResponse} QuoteResponse */

/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {string | number} [chain] - The chain the wallet account operates on, i.e. the swidge **source** chain: an EVM chain id (1, 137, 42161) or 'Bitcoin' | 'Arkade' | 'Lightning'. Detected automatically for WDK EVM accounts (from their provider) and Lightning accounts; required for Bitcoin and Arkade accounts.
 * @property {number} [defaultSlippage] - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
 * @property {number} [feeRateSatPerVb] - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
 * @property {number} [lightningMaxFeeSats] - Maximum routing fee (sats) a Lightning account may pay for the swap invoice.
 * @property {WalletStorage} [signerStorage] - Persists the swap client's key index. Recommended for fund-moving operations so an interrupted swap survives a restart.
 * @property {SwapStorage} [swapStorage] - Persists per-swap state (the preimage, keys, last response) for recovery/refund.
 * @property {string} [baseUrl] - Override the satora API base URL. Defaults to the SDK's production endpoint.
 * @property {string} [arkadeServerUrl] - Override the Arkade server URL.
 * @property {string} [esploraUrl] - Override the Esplora (Bitcoin) API URL.
 */

/**
 * @typedef {Object} SatoraRefundOptions
 * @property {boolean} [manual] - For an EVM-sourced swap: use the timelock-based refund (the account pays gas) instead of the gasless collaborative one. Ignored for Arkade/Bitcoin sources, whose other fields are forwarded as {@link RefundOptions}.
 */

/**
 * @typedef {Object} SwidgeRoute
 * @property {string} sourceChain - The satora source chain id.
 * @property {string} sourceToken - The source token id (`btc` or a contract address).
 * @property {string} targetChain - The satora destination chain id.
 * @property {string} targetToken - The destination token id.
 */

export default class SatoraProtocol extends SwidgeProtocol {
  /**
   * Creates a new satora swidge protocol without binding it to a wallet account.
   *
   * @overload
   * @param {undefined} [account] - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */

  /**
   * Creates a new read-only satora swidge protocol.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */

  /**
   * Creates a new satora swidge protocol.
   *
   * The account is the **source** wallet: it funds the swap on its own chain
   * (`config.chain`, or detected from the account) and also provides the swap
   * client's key material, so no separate secret is needed.
   *
   * @overload
   * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * The satora protocol configuration.
     *
     * @protected
     * @type {SatoraProtocolConfig}
     */
    this._config = config

    /** @private */
    this._clientPromise = undefined

    /** @private */
    this._signingClientPromise = undefined

    /** @private */
    this._evmSignerPromise = undefined

    /** @private */
    this._detectedChain = undefined
  }

  /**
   * Lazily constructs (and memoizes) a read-only satora swap client, used for
   * discovery, quotes and status lookups.
   *
   * @protected
   * @returns {Promise<SatoraClient>} The satora swap client.
   */
  async _getClient () {
    if (!this._clientPromise) this._clientPromise = this._buildClient()
    return this._clientPromise
  }

  /**
   * Lazily constructs (and memoizes) the signing satora swap client, whose key
   * material (HTLC preimage + claim/refund keys) is derived from the wallet
   * account. Required by every fund-moving operation.
   *
   * @protected
   * @returns {Promise<SatoraClient>} The satora swap client.
   * @throws {SatoraInvalidOptionsError} If no account is bound or it cannot derive the swap key.
   */
  async _getSigningClient () {
    if (!this._account) {
      throw new SatoraInvalidOptionsError('this operation requires a wallet account')
    }
    if (!this._signingClientPromise) {
      this._signingClientPromise = deriveSwapXprv(this._account).then(xprv => this._buildClient(xprv))
    }
    return this._signingClientPromise
  }

  /**
   * @private
   * @param {string} [xprv] - The swap client's key material; omitted for a read-only client.
   * @returns {Promise<SatoraClient>} The satora swap client.
   */
  _buildClient (xprv) {
    let builder = Client.builder()
    if (this._config.baseUrl) builder = builder.withBaseUrl(this._config.baseUrl)
    if (this._config.arkadeServerUrl) builder = builder.withArkadeServerUrl(this._config.arkadeServerUrl)
    if (this._config.esploraUrl) builder = builder.withEsploraUrl(this._config.esploraUrl)
    if (this._config.signerStorage) builder = builder.withSignerStorage(this._config.signerStorage)
    if (this._config.swapStorage) builder = builder.withSwapStorage(this._config.swapStorage)
    if (xprv) builder = builder.withXprv(xprv)
    return builder.build()
  }

  /**
   * Resolves the swidge route. The source chain is the account's chain
   * (`config.chain`, or detected from the account); the destination chain is
   * `toChain`, defaulting to the source chain. Tokens are bare provider ids
   * (`btc` or a contract address); a chain-qualified `chain:tokenId` is also
   * accepted on either side.
   *
   * @protected
   * @param {SwidgeOptions} options - The swidge options.
   * @returns {Promise<SwidgeRoute>} The route.
   * @throws {SatoraInvalidOptionsError} If a token is missing or the source chain cannot be determined.
   */
  async _resolveRoute (options) {
    if (!options.fromToken || !options.toToken) {
      throw new SatoraInvalidOptionsError('fromToken and toToken are required')
    }

    const source = parseTokenId(options.fromToken)
    const target = parseTokenId(options.toToken)

    const sourceChain = await this._resolveSourceChain(source.chain)
    const targetChain = target.chain !== undefined
      ? normalizeChain(target.chain)
      : options.toChain !== undefined && options.toChain !== null
        ? normalizeChain(options.toChain)
        : sourceChain

    return { sourceChain, sourceToken: source.tokenId, targetChain, targetToken: target.tokenId }
  }

  /**
   * @private
   * @param {string} [qualified] - The chain prefix carried by `fromToken`, if any.
   * @returns {Promise<string>} The satora source chain id.
   */
  async _resolveSourceChain (qualified) {
    const declared = this._config.chain !== undefined && this._config.chain !== null
      ? normalizeChain(this._config.chain)
      : undefined
    const fromToken = qualified !== undefined ? normalizeChain(qualified) : undefined

    if (declared !== undefined && fromToken !== undefined && declared !== fromToken) {
      throw new SatoraInvalidOptionsError(
        `fromToken is on chain "${fromToken}" but the account operates on "${declared}" (config.chain)`
      )
    }

    const chain = declared ?? fromToken ?? await this._detectAccountChain()
    if (chain === undefined) {
      throw new SatoraInvalidOptionsError(
        'cannot determine the source chain: set config.chain to the account\'s chain ' +
        '(e.g. 42161, "Bitcoin", "Arkade", "Lightning") or qualify fromToken as "chain:tokenId"'
      )
    }
    return chain
  }

  /**
   * Detects the account's chain: Lightning accounts pay invoices, EVM accounts
   * report their chain id through their provider. Bitcoin and Arkade accounts
   * are indistinguishable and must declare `config.chain`.
   *
   * @private
   * @returns {Promise<string | undefined>} The satora chain id, if detectable.
   */
  async _detectAccountChain () {
    if (this._detectedChain !== undefined) return this._detectedChain ?? undefined

    const account = this._account
    let chain
    if (account) {
      if (typeof account.payLightningInvoice === 'function' || typeof account.payInvoice === 'function') {
        chain = 'Lightning'
      } else {
        const chainId = await detectEvmChainId(account)
        if (chainId !== undefined) chain = String(chainId)
      }
    }

    this._detectedChain = chain ?? null
    return chain
  }

  /**
   * Adapts the bound account to the SDK's {@link EvmSigner} (memoized).
   *
   * @private
   * @param {string} chain - The EVM source chain id.
   * @returns {Promise<EvmSigner>} The signer.
   */
  async _getEvmSigner (chain) {
    if (!this._evmSignerPromise) this._evmSignerPromise = toEvmSigner(this._account, Number(chain))
    return this._evmSignerPromise
  }

  /**
   * Quotes the estimated costs and output of a swidge operation.
   * Returns a non-binding quote; the actual execution is performed
   * by {@link swidge}.
   *
   * `fromToken`/`toToken` are the provider token ids (`btc`, or the ERC-20
   * contract address). The source chain is the account's chain; the
   * destination chain is `toChain` (defaulting to the source chain). Without
   * an account, qualify the source as `chain:tokenId` or set `config.chain`.
   *
   * @param {SwidgeOptions} options - The swidge options.
   * @returns {Promise<SwidgeQuote>} The quoted swidge details.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If the route cannot be resolved or no amount is given.
   */
  async quoteSwidge (options) {
    const route = await this._resolveRoute(options)

    const params = {
      sourceChain: route.sourceChain,
      sourceToken: route.sourceToken,
      targetChain: route.targetChain,
      targetToken: route.targetToken
    }

    if (options.fromTokenAmount !== undefined && options.fromTokenAmount !== null) {
      params.sourceAmount = BigInt(options.fromTokenAmount)
    } else if (options.toTokenAmount !== undefined && options.toTokenAmount !== null) {
      params.targetAmount = BigInt(options.toTokenAmount)
    } else {
      throw new SatoraInvalidOptionsError(
        'either fromTokenAmount (exact-in) or toTokenAmount (exact-out) is required'
      )
    }

    const client = await this._getClient()
    const quote = await client.getQuote(params)

    const toTokenAmount = BigInt(quote.net_target_amount)
    const slippage = options.slippage ?? this._config.defaultSlippage ?? 0

    return {
      fromTokenAmount: BigInt(quote.net_source_amount),
      toTokenAmount,
      toTokenAmountMin: applySlippage(toTokenAmount, slippage),
      fees: toSwidgeFees(quote)
    }
  }

  /**
   * Executes a swidge operation, driving the full atomic-swap flow to
   * completion (one-shot): create the swap, fund the source HTLC from the
   * wallet account, wait for the server to lock the destination, claim, and
   * wait for settlement.
   *
   * The account is the source wallet, so `options.recipient` (the address on
   * the destination chain) is always required. Pass `options.minAmountOut`
   * (typically the `toTokenAmountMin` of the quote the user accepted) to
   * abort — before any funds move — if the swap would deliver less.
   *
   * Implemented directions: Arkade / Bitcoin / Lightning -> EVM and
   * EVM -> Arkade / Bitcoin / Lightning. An EVM account is a WDK EVM wallet
   * account (or an {@link EvmSigner}); it signs and sends the HTLC funding.
   *
   * @param {SwidgeOptions} options - The swidge options.
   * @param {SwidgeProtocolConfig} [config] - Optional provider-specific execution configuration.
   * @returns {Promise<SwidgeResult>} The swidge execution result.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If the account, direction, recipient, or amount is invalid.
   * @throws {import('./errors.js').SatoraMinAmountOutError} If the swap would deliver less than `minAmountOut`.
   * @throws {Error} If the swap is refunded, expires, or times out.
   */
  async swidge (options, config) {
    const account = this._account
    if (!account) {
      throw new SatoraInvalidOptionsError('swidge requires a wallet account to fund the swap')
    }

    const route = await this._resolveRoute(options)

    const recipient = options.recipient
    if (!recipient) {
      throw new SatoraInvalidOptionsError(
        'swidge requires options.recipient (the destination address); the account is the source wallet'
      )
    }

    const client = await this._getSigningClient()
    const context = { route, recipient, options }

    const { sourceChain, targetChain } = route
    if (sourceChain === 'Arkade' && isEvmChain(targetChain)) {
      return this._swidgeArkadeToEvm(client, account, context)
    }
    if (sourceChain === 'Bitcoin' && isEvmChain(targetChain)) {
      return this._swidgeBitcoinToEvm(client, account, context)
    }
    if (sourceChain === 'Lightning' && isEvmChain(targetChain)) {
      return this._swidgeLightningToEvm(client, account, context)
    }
    if (isEvmChain(sourceChain) && targetChain === 'Arkade') {
      return this._swidgeEvmToArkade(client, context)
    }
    if (isEvmChain(sourceChain) && targetChain === 'Bitcoin') {
      return this._swidgeEvmToBitcoin(client, context)
    }
    if (isEvmChain(sourceChain) && targetChain === 'Lightning') {
      return this._swidgeEvmToLightning(client, context)
    }

    throw new SatoraInvalidOptionsError(
      `unsupported swidge direction ${sourceChain} -> ${targetChain}; ` +
      'implemented: Arkade/Bitcoin/Lightning -> EVM, and EVM -> Arkade/Bitcoin/Lightning'
    )
  }

  /** @private */
  async _swidgeArkadeToEvm (client, account, { route, recipient, options }) {
    if (typeof account.sendTransaction !== 'function') {
      throw new SatoraInvalidOptionsError('Arkade -> EVM swidge requires an Arkade wallet account (with sendTransaction)')
    }
    const sourceAmount = requireFromAmount(options, 'Arkade -> EVM')

    const { response } = await client.createArkadeToEvmSwapGeneric({
      targetAddress: recipient,
      tokenAddress: route.targetToken,
      evmChainId: Number(route.targetChain),
      sourceAmount
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Fund the Arkade VHTLC from the source account.
    const funding = await account.sendTransaction({ to: response.btc_vhtlc_address, value: fromTokenAmount })

    const { swap: final, claim } = await this._completeSwap(client, id)

    const claimTx = final.evm_claim_txid ?? claim.txHash
    const transactions = [{ hash: funding.hash, chain: 'Arkade', type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: Number(route.targetChain), type: 'destination' })

    return { id, hash: claimTx ?? funding.hash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }
  }

  /** @private */
  async _swidgeBitcoinToEvm (client, account, { route, recipient, options }) {
    if (typeof account.sendTransaction !== 'function') {
      throw new SatoraInvalidOptionsError('Bitcoin -> EVM swidge requires a Bitcoin wallet account (with sendTransaction)')
    }
    const sourceAmount = requireFromAmount(options, 'Bitcoin -> EVM')

    const { response } = await client.createBitcoinToEvmSwap({
      targetAddress: recipient,
      tokenAddress: route.targetToken,
      evmChainId: Number(route.targetChain),
      sourceAmount: toSafeNumber(sourceAmount, 'fromTokenAmount')
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Fund the on-chain Bitcoin HTLC from the source account.
    const funding = await account.sendTransaction({ to: response.btc_htlc_address, value: fromTokenAmount })

    const { swap: final, claim } = await this._completeSwap(client, id, { timeoutMs: BTC_ONCHAIN_TIMEOUT_MS })

    const claimTx = final.evm_claim_txid ?? claim.txHash
    const transactions = [{ hash: funding.hash, chain: 'Bitcoin', type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: Number(route.targetChain), type: 'destination' })

    return { id, hash: claimTx ?? funding.hash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }
  }

  /** @private */
  async _swidgeLightningToEvm (client, account, { route, recipient, options }) {
    if (typeof account.payLightningInvoice !== 'function' && typeof account.payInvoice !== 'function') {
      throw new SatoraInvalidOptionsError('Lightning -> EVM swidge requires a Lightning wallet account (with payLightningInvoice)')
    }
    const sourceAmount = requireFromAmount(options, 'Lightning -> EVM')

    const { response } = await client.createLightningToEvmSwap({
      targetAddress: recipient,
      evmChainId: Number(route.targetChain),
      tokenAddress: route.targetToken,
      sourceAmount: toSafeNumber(sourceAmount, 'fromTokenAmount')
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Pay the hold invoice concurrently with completion: the invoice only
    // settles once the swap reveals the preimage (during claim), so awaiting it
    // before _completeSwap would deadlock — but both must succeed. Promise.all
    // also surfaces a payment failure (e.g. insufficient funds) promptly instead
    // of letting _completeSwap poll until it times out.
    const payment = Promise.resolve()
      .then(() => payLightningInvoice(account, response.bolt11_invoice, this._config.lightningMaxFeeSats))
      .catch(err => { throw new Error(`lightning payment failed: ${err?.message ?? err}`) })

    const [{ swap: final, claim }] = await Promise.all([this._completeSwap(client, id), payment])

    const claimTx = final.evm_claim_txid ?? claim.txHash
    const transactions = []
    if (claimTx) transactions.push({ hash: claimTx, chain: Number(route.targetChain), type: 'destination' })

    return { id, hash: claimTx, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }
  }

  /** @private */
  async _swidgeEvmToArkade (client, { route, recipient, options }) {
    const sourceAmount = requireFromAmount(options, 'EVM -> Arkade')
    const signer = await this._getEvmSigner(route.sourceChain)

    const { response } = await client.createEvmToArkadeSwapGeneric({
      targetAddress: recipient,
      tokenAddress: route.sourceToken,
      evmChainId: Number(route.sourceChain),
      userAddress: signer.address,
      sourceAmount
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Fund the EVM HTLC with the account (token approval + deposit).
    const { txHash } = await client.fundSwap(id, signer)

    const { swap: final } = await this._completeSwap(client, id)

    const claimTx = final.btc_claim_txid
    const transactions = [{ hash: txHash, chain: Number(route.sourceChain), type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: 'Arkade', type: 'destination' })

    return { id, hash: claimTx ?? txHash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }
  }

  /** @private */
  async _swidgeEvmToBitcoin (client, { route, recipient, options }) {
    const sourceAmount = requireFromAmount(options, 'EVM -> Bitcoin')
    const signer = await this._getEvmSigner(route.sourceChain)

    const { response } = await client.createEvmToBitcoinSwap({
      targetAddress: recipient,
      tokenAddress: route.sourceToken,
      evmChainId: Number(route.sourceChain),
      userAddress: signer.address,
      sourceAmount
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Fund the EVM HTLC, then claim the BTC HTLC on-chain to the recipient.
    const { txHash } = await client.fundSwap(id, signer)
    const { swap: final, claim } = await this._completeSwap(
      client, id, { timeoutMs: BTC_ONCHAIN_TIMEOUT_MS },
      { destinationAddress: recipient, feeRateSatPerVb: this._config.feeRateSatPerVb }
    )

    const claimTx = final.btc_claim_txid ?? claim.txHash
    const transactions = [{ hash: txHash, chain: Number(route.sourceChain), type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: 'Bitcoin', type: 'destination' })

    return { id, hash: claimTx ?? txHash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount, toTokenAmountMin }
  }

  /** @private */
  async _swidgeEvmToLightning (client, { route, recipient, options }) {
    const signer = await this._getEvmSigner(route.sourceChain)

    const { response } = await client.createEvmToLightningSwap({
      evmChainId: Number(route.sourceChain),
      tokenAddress: route.sourceToken,
      userAddress: signer.address,
      ...lightningDestination(recipient, options)
    })

    const { id, fromTokenAmount, toTokenAmount, toTokenAmountMin } = acceptSwap(response, options)

    // Fund the EVM HTLC with the account. The server then pays the Lightning
    // invoice and claims the EVM HTLC — there is no client claim, so just wait
    // for the swap to settle.
    const { txHash } = await client.fundSwap(id, signer)
    await this._waitForSwapStatus(client, id, TERMINAL_SUCCESS_STATES, TERMINAL_FAIL_STATES)

    return {
      id,
      hash: txHash,
      fees: swapFee(response.fee_sats),
      transactions: [{ hash: txHash, chain: Number(route.sourceChain), type: 'source' }],
      fromTokenAmount,
      toTokenAmount,
      toTokenAmountMin
    }
  }

  /** @private */
  async _waitForSwapStatus (client, id, targets, failStates, { timeoutMs = 600000, intervalMs = 3000 } = {}) {
    const target = new Set(targets)
    const fail = new Set(failStates)
    const deadline = Date.now() + timeoutMs

    while (true) {
      const swap = await client.getSwap(id)
      if (target.has(swap.status)) return swap
      if (fail.has(swap.status)) {
        throw new Error(`satora swap ${id} failed with status "${swap.status}"`)
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for satora swap ${id} to reach ${targets.join('/')} (last status "${swap.status}")`)
      }
      await sleep(intervalMs)
    }
  }

  /** @private */
  async _completeSwap (client, id, waitOpts = {}, claimOptions) {
    await this._waitForSwapStatus(client, id, SERVER_FUNDED_STATES, FUND_FAIL_STATES, waitOpts)

    const claim = await client.claim(id, claimOptions)
    if (!claim.success) {
      throw new Error(`satora claim failed for swap ${id}: ${claim.message}`)
    }

    const swap = await this._waitForSwapStatus(client, id, TERMINAL_SUCCESS_STATES, TERMINAL_FAIL_STATES, waitOpts)
    return { swap, claim }
  }

  /**
   * Retrieves the current status of an in-flight swidge.
   *
   * @param {string} id - The swidge execution identifier returned by swidge.
   * @param {SwidgeStatusOptions} [options] - Optional hints to assist provider lookups.
   * @returns {Promise<SwidgeStatusResult>} The current swidge status.
   * @throws {Error} If the id is invalid, or no swidge exists with the given identifier.
   */
  async getSwidgeStatus (id, options) {
    const client = await this._getClient()
    const swap = await client.getSwap(id)

    const result = { status: toSwidgeStatus(swap.status) }
    const transactions = toSwidgeTransactions(swap)
    if (transactions.length > 0) result.transactions = transactions

    return result
  }

  /**
   * Resumes a persisted swap, driving it to completion: waits for the
   * destination to be locked, claims (gaslessly, to the swap's stored
   * recipient), and settles. Throws if the swap cannot complete (e.g. it
   * expired or was refunded).
   *
   * This is a recovery operation for a swap interrupted after {@link swidge}
   * created and funded it (e.g. the process died mid-flight). It needs the
   * same account (the swap key is derived from it) and the same storage.
   *
   * @param {string} id - The swap id.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [options] - Polling overrides.
   * @returns {Promise<SwidgeStatusResult & { id: string }>} The 'completed' status and transactions.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If no account is bound.
   * @throws {Error} If the swap cannot be completed.
   */
  async resumeSwidge (id, options = {}) {
    const client = await this._getSigningClient()

    const waitOpts = {}
    if (options.timeoutMs !== undefined) waitOpts.timeoutMs = options.timeoutMs
    if (options.intervalMs !== undefined) waitOpts.intervalMs = options.intervalMs

    const existing = await client.getSwap(id)

    // Already settled — nothing to resume.
    if (toSwidgeStatus(existing.status) === 'completed') {
      return { id, status: 'completed', transactions: toSwidgeTransactions(existing) }
    }

    // An EVM -> Bitcoin claim pays out on-chain, so it needs the recorded BTC
    // destination (and honours the configured fee rate).
    const claimOptions = existing.target_btc_address
      ? { destinationAddress: existing.target_btc_address, feeRateSatPerVb: this._config.feeRateSatPerVb }
      : undefined

    const { swap } = await this._completeSwap(client, id, waitOpts, claimOptions)
    return { id, status: 'completed', transactions: toSwidgeTransactions(swap) }
  }

  /**
   * Refunds a swap that can no longer complete, reclaiming the source funds.
   * Use this when {@link resumeSwidge} throws. The mechanism depends on the swap
   * direction:
   * - **EVM source** (EVM -> Arkade/Bitcoin/Lightning): reclaims the EVM HTLC
   *   with the account. Collaborative (gasless, no timelock wait) by default,
   *   which needs an EOA signature; pass `options.manual` for the timelock-based
   *   refund (works for any account, including ERC-4337 smart accounts). The
   *   refund pays out the BTC-pegged HTLC token (tBTC/WBTC) to the depositor.
   * - **Arkade/Bitcoin source**: reclaims to the account's address via the
   *   satora refund (`options` are forwarded, e.g. an on-chain `feeRateSatPerVb`).
   * - **Lightning source**: cannot be refunded — the unpaid invoice expires.
   *
   * @param {string} id - The swap id.
   * @param {SatoraRefundOptions} [options] - Refund options (`manual` for EVM sources; SDK {@link RefundOptions} fields are forwarded for Arkade/Bitcoin sources).
   * @returns {Promise<SwidgeStatusResult & { id: string, message?: string }>} The 'refunded' status and transactions.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If no (suitable) account is bound, or the direction cannot be refunded.
   * @throws {Error} If the swap cannot be refunded.
   */
  async refundSwidge (id, options = {}) {
    const account = this._account
    if (!account) {
      throw new SatoraInvalidOptionsError('refund requires a wallet account')
    }

    const client = await this._getSigningClient()
    const swap = await client.getSwap(id, { updateStorage: true })
    const direction = swap.direction ?? ''

    // EVM-sourced: reclaim the EVM HTLC with the account.
    if (direction.startsWith('evm_to_')) {
      const chainId = swap.evm_chain_id
      const signer = await this._getEvmSigner(String(chainId ?? await this._resolveSourceChain(undefined)))
      const { txHash } = options.manual
        ? await client.refundEvmWithSigner(id, signer)
        : await client.collabRefundEvmWithSigner(id, signer)

      const after = await client.getSwap(id, { updateStorage: true })
      const transactions = toSwidgeTransactions(after)
      transactions.push({ hash: txHash, chain: after.evm_chain_id ?? chainId, type: 'refund' })
      return { id, status: 'refunded', transactions, message: 'evm refund submitted' }
    }

    // Lightning-sourced: nothing to reclaim — the unpaid invoice just expires.
    if (direction === 'lightning_to_evm') {
      throw new SatoraInvalidOptionsError('a Lightning -> EVM swap cannot be refunded; the unpaid invoice expires on its own')
    }

    // Arkade/Bitcoin-sourced: reclaim to the account's address.
    if (typeof account.getAddress !== 'function') {
      throw new SatoraInvalidOptionsError('refund requires a wallet account to receive the refund')
    }
    const refundOptions = { destinationAddress: await account.getAddress(), ...options }
    // TODO: we should check if refund is available and throw otherwise. This
    // should be provided upstream in the SDK.
    const refund = await client.refundSwap(id, refundOptions)
    const after = await client.getSwap(id, { updateStorage: true })

    if (!refund.success) {
      throw new Error(`swap ${id} could not be refunded (status "${after.status}"): ${refund.message}`)
    }

    const transactions = toSwidgeTransactions(after)
    if (refund.txId) transactions.push({ hash: refund.txId, type: 'refund' })

    return { id, status: 'refunded', transactions, message: refund.message }
  }

  /**
   * Retrieves the chains supported by the provider for swidge operations.
   *
   * @returns {Promise<SwidgeSupportedChain[]>} The supported chains.
   */
  async getSupportedChains () {
    const client = await this._getClient()
    const { pairs } = await client.getSwapPairs()

    const chains = new Map()
    for (const { source, target } of pairs) {
      for (const sdkChain of [source, target]) {
        if (!chains.has(sdkChain)) chains.set(sdkChain, toSupportedChain(sdkChain))
      }
    }

    return [...chains.values()]
  }

  /**
   * Retrieves the tokens supported by the provider for swidge operations.
   * Each token's `token` is the provider id to pass as `fromToken`/`toToken`
   * (`btc`, or the ERC-20 contract address); `chain` carries its chain.
   *
   * @param {SwidgeSupportedTokensOptions} [options] - Optional filters for chain- or route-scoped token discovery.
   * @returns {Promise<SwidgeSupportedToken[]>} The supported tokens.
   */
  async getSupportedTokens (options = {}) {
    const client = await this._getClient()
    const { btc_tokens: btcTokens, evm_tokens: evmTokens } = await client.getTokens()

    const tokens = [...btcTokens, ...evmTokens].map(toSupportedToken)

    // Route-scoped discovery (best effort): satora's token catalogue is not
    // route-aware, so when fromChain/toChain are supplied we narrow the result
    // to tokens on those chains. fromToken cannot be applied with the available
    // API and is ignored.
    const chainFilter = [options.fromChain, options.toChain]
      .filter(chain => chain !== undefined && chain !== null)
      .map(chain => normalizeChain(chain))

    if (chainFilter.length === 0) return tokens

    const allowed = new Set(chainFilter)
    return tokens.filter(token => allowed.has(String(token.chain)))
  }
}

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */

// Satora prices everything in BTC terms, so all quoted fees are in satoshis and
// denominated in the native BTC token.
const FEE_TOKEN = 'btc'
const FEE_CHAIN = 'Bitcoin'

// On-chain Bitcoin funding/claims confirm on the Bitcoin network, which is much
// slower than Arkade/Lightning, so those directions poll for longer.
const BTC_ONCHAIN_TIMEOUT_MS = 3600000

// Swap status groupings for driving the swap flow (satora SwapStatus state
// machine).
const SERVER_FUNDED_STATES = ['serverfunded']
const FUND_FAIL_STATES = ['expired', 'clientrefunded', 'clientfundedserverrefunded', 'serverwontfund', 'clientfundedtoolate', 'clientinvalidfunded', 'clientredeemedandclientrefunded']
const TERMINAL_SUCCESS_STATES = ['serverredeemed', 'clientredeemed']
const TERMINAL_FAIL_STATES = ['expired', 'clientrefunded', 'clientfundedserverrefunded', 'clientrefundedserverfunded', 'clientrefundedserverrefunded', 'clientredeemedandclientrefunded']

// Maps the satora SwapStatus state machine onto the WDK SwidgeStatus vocabulary.
const SWAP_STATUS_TO_SWIDGE = {
  pending: 'pending',
  clientfundingseen: 'pending',
  clientfunded: 'pending',
  serverfunded: 'action-required', // destination locked; the client must claim to receive
  clientredeeming: 'pending',
  clientredeemed: 'completed',
  serverredeemed: 'completed',
  clientrefunded: 'refunded',
  clientfundedserverrefunded: 'refunded',
  clientrefundedserverfunded: 'refunded',
  clientrefundedserverrefunded: 'refunded',
  expired: 'expired',
  clientinvalidfunded: 'action-required', // client needs to refund
  clientfundedtoolate: 'action-required', // client needs to refund
  serverwontfund: 'failed',
  clientredeemedandclientrefunded: 'completed'
}

/**
 * Maps a satora swap status to a WDK swidge status. Unknown statuses fall back
 * to 'pending' so an in-flight swap is never misreported as terminal.
 *
 * @param {string} status - The satora swap status.
 * @returns {import('@tetherto/wdk-wallet/protocols').SwidgeStatus} The WDK swidge status.
 */
function toSwidgeStatus (status) {
  return SWAP_STATUS_TO_SWIDGE[status] ?? 'pending'
}

/**
 * Extracts the user-facing source/destination transactions from a satora swap,
 * best effort. Which txids are the source vs destination depends on the swap
 * direction (arkade funds via BTC, EVM funds via the HTLC contract); defaults
 * to the Arkade -> EVM layout when `direction` is absent.
 *
 * @param {GetSwapResponse} swap - The satora swap, as returned by `client.getSwap`.
 * @returns {import('@tetherto/wdk-wallet/protocols').SwidgeTransaction[]} The transactions.
 */
function toSwidgeTransactions (swap) {
  const transactions = []
  const direction = swap.direction ?? ''
  const evmChain = swap.evm_chain_id

  if (direction.startsWith('evm_to_')) {
    // EVM source funds the HTLC; the BTC/Arkade side is the destination.
    if (swap.evm_fund_txid) transactions.push({ hash: swap.evm_fund_txid, chain: evmChain, type: 'source' })
    const destChain = direction === 'evm_to_bitcoin' ? 'Bitcoin' : 'Arkade'
    if (swap.btc_claim_txid) transactions.push({ hash: swap.btc_claim_txid, chain: destChain, type: 'destination' })
  } else {
    // *_to_evm: the BTC/Arkade side funds, the EVM side is the destination.
    // Default to Arkade when the direction is absent (back-compat).
    const srcChain = direction === 'bitcoin_to_evm' ? 'Bitcoin' : 'Arkade'
    if (swap.btc_fund_txid) transactions.push({ hash: swap.btc_fund_txid, chain: srcChain, type: 'source' })
    if (swap.evm_claim_txid) transactions.push({ hash: swap.evm_claim_txid, chain: evmChain, type: 'destination' })
  }
  return transactions
}

/**
 * Reads the created swap's amounts and enforces the caller's `minAmountOut`
 * guard before anything is funded. A rejected swap is simply left unfunded and
 * expires on its own.
 *
 * @param {{ id: string, source_amount: string | number, target_amount: string | number }} response - The create-swap response.
 * @param {SwidgeOptions} options - The swidge options.
 * @returns {{ id: string, fromTokenAmount: bigint, toTokenAmount: bigint, toTokenAmountMin: bigint }} The accepted amounts.
 * @throws {SatoraMinAmountOutError} If the swap would deliver less than `minAmountOut`.
 */
function acceptSwap (response, options) {
  const id = response.id
  const fromTokenAmount = BigInt(response.source_amount)
  const toTokenAmount = BigInt(response.target_amount)

  const minAmountOut = options.minAmountOut !== undefined && options.minAmountOut !== null
    ? BigInt(options.minAmountOut)
    : applySlippage(toTokenAmount, options.slippage ?? 0)

  if (toTokenAmount < minAmountOut) {
    throw new SatoraMinAmountOutError(id, toTokenAmount, minAmountOut)
  }

  return { id, fromTokenAmount, toTokenAmount, toTokenAmountMin: minAmountOut }
}

/**
 * Returns `fromTokenAmount` (an exact-in source amount) as a bigint, throwing
 * if it is absent.
 *
 * @param {SwidgeOptions} options - The swidge options.
 * @param {string} direction - The direction label, for the error message.
 * @returns {bigint} The source amount in base units.
 */
function requireFromAmount (options, direction) {
  if (options.fromTokenAmount === undefined || options.fromTokenAmount === null) {
    throw new SatoraInvalidOptionsError(`${direction} swidge requires fromTokenAmount (exact-in)`)
  }
  return BigInt(options.fromTokenAmount)
}

/**
 * Converts a bigint to a number where the SDK requires one, refusing values
 * that cannot be represented exactly.
 *
 * @param {bigint} value - The value.
 * @param {string} label - The option name, for the error message.
 * @returns {number} The number.
 */
function toSafeNumber (value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new SatoraInvalidOptionsError(`${label} ${value} exceeds the safe integer range`)
  }
  return Number(value)
}

/**
 * Pays a BOLT11 invoice with the Lightning account: a WDK Spark account
 * (`payLightningInvoice({ invoice, maxFeeSats })`) or any account exposing
 * `payInvoice(bolt11)`.
 *
 * @param {Object} account - The Lightning wallet account.
 * @param {string} invoice - The BOLT11 invoice.
 * @param {number} [maxFeeSats] - The maximum routing fee.
 * @returns {Promise<unknown>} The payment result.
 */
function payLightningInvoice (account, invoice, maxFeeSats) {
  if (typeof account.payLightningInvoice === 'function') {
    const params = { invoice }
    if (maxFeeSats !== undefined) params.maxFeeSats = maxFeeSats
    return account.payLightningInvoice(params)
  }
  return account.payInvoice(invoice)
}

/**
 * Resolves a Lightning destination from `options.recipient` into the shape the
 * SDK expects: a BOLT11 invoice (amount carried by the invoice), a lightning
 * address, or an LNURL. The latter two carry no amount, so the payout is
 * pinned by the destination amount `toTokenAmount` (sats the recipient
 * receives, `targetAmountSats`) — never by `fromTokenAmount`, which is the
 * source token amount for the swap.
 *
 * @param {string} recipient - The BOLT11 invoice, lightning address, or LNURL.
 * @param {SwidgeOptions} options - The swidge options.
 * @returns {{ lightningInvoice: string } | { lightningAddress: string, targetAmountSats: number } | { lnurl: string, targetAmountSats: number }}
 */
function lightningDestination (recipient, options) {
  if (/^ln(bc|tb|bcrt)/i.test(recipient)) {
    return { lightningInvoice: recipient }
  }

  if (options.toTokenAmount === undefined || options.toTokenAmount === null) {
    throw new SatoraInvalidOptionsError(
      'a lightning address / LNURL destination requires the payout amount in sats (toTokenAmount)'
    )
  }
  const targetAmountSats = toSafeNumber(BigInt(options.toTokenAmount), 'toTokenAmount')

  if (/^lnurl/i.test(recipient)) return { lnurl: recipient, targetAmountSats }
  return { lightningAddress: recipient, targetAmountSats }
}

/**
 * Builds the itemised WDK fee list from a swap's `fee_sats` (satora prices the
 * swap fee in satoshis, denominated in BTC).
 *
 * @param {number|string} feeSats - The swap fee in satoshis.
 * @returns {SwidgeFee[]} The fees.
 */
function swapFee (feeSats) {
  return [{
    type: 'protocol',
    amount: BigInt(feeSats),
    token: FEE_TOKEN,
    chain: FEE_CHAIN,
    included: true,
    description: 'Swap fee'
  }]
}

/**
 * Resolves after `ms` milliseconds.
 *
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>}
 */
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Reduces an amount by a slippage tolerance using basis-point integer math.
 *
 * @param {bigint} amount - The amount in base units.
 * @param {number} slippage - The slippage as a decimal (e.g. 0.01 for 1%).
 * @returns {bigint} The amount after applying slippage.
 */
function applySlippage (amount, slippage) {
  if (!slippage || slippage <= 0) return amount
  const bps = BigInt(Math.round(slippage * 10000))
  return amount - (amount * bps) / 10000n
}

/**
 * Maps a satora quote response to the itemised WDK fee breakdown. The satora
 * `net_source_amount`/`net_target_amount` already account for fees, so each fee
 * is reported with `included: true`.
 *
 * @param {QuoteResponse} quote - The satora quote response, as returned by `client.getQuote`.
 * @returns {SwidgeFee[]} The itemised fees.
 */
function toSwidgeFees (quote) {
  const fees = [
    {
      type: 'protocol',
      amount: BigInt(quote.protocol_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: `Protocol fee (rate ${quote.protocol_fee_rate})`
    },
    {
      type: 'network',
      amount: BigInt(quote.network_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: 'Network fee (HTLC create/claim + BTC mining)'
    }
  ]

  if (quote.gasless_network_fee) {
    fees.push({
      type: 'network',
      amount: BigInt(quote.gasless_network_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: 'Gasless DEX execution gas'
    })
  }

  return fees
}
