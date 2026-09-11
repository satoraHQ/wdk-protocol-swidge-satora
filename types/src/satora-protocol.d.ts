import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
export type IWalletAccount = import('@tetherto/wdk-wallet').IWalletAccount;
export type IWalletAccountReadOnly = import('@tetherto/wdk-wallet').IWalletAccountReadOnly;
export type SwidgeOptions = import('@tetherto/wdk-wallet/protocols').SwidgeOptions;
export type SwidgeQuote = import('@tetherto/wdk-wallet/protocols').SwidgeQuote;
export type SwidgeResult = import('@tetherto/wdk-wallet/protocols').SwidgeResult;
export type SwidgeProtocolConfig = import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig;
export type SwidgeStatusOptions = import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions;
export type SwidgeStatusResult = import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult;
export type SwidgeSupportedChain = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain;
export type SwidgeSupportedToken = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions;
export type SatoraClient = import('@satora/swap').Client;
export type EvmSigner = import('@satora/swap').EvmSigner;
export type WalletStorage = import('@satora/swap').WalletStorage;
export type SwapStorage = import('@satora/swap').SwapStorage;
export type GetSwapResponse = import('@satora/swap').GetSwapResponse;
export type RefundOptions = import('@satora/swap').RefundOptions;
export type ClaimOptions = import('@satora/swap').ClaimOptions;
export type QuoteResponse = import('@satora/swap').QuoteResponse;
export type SatoraProtocolConfig = {
    /**
     * - The chain the wallet account operates on, i.e. the swidge **source** chain: an EVM chain id (1, 137, 42161) or 'Bitcoin' | 'Arkade' | 'Lightning'. Detected automatically for WDK EVM accounts (from their provider) and Lightning accounts; required for Bitcoin and Arkade accounts.
     */
    chain?: string | number;
    /**
     * - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
     */
    defaultSlippage?: number;
    /**
     * - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
     */
    feeRateSatPerVb?: number;
    /**
     * - Maximum routing fee (sats) a Lightning account may pay for the swap invoice.
     */
    lightningMaxFeeSats?: number;
    /**
     * - Persists the swap client's key index. Recommended for fund-moving operations so an interrupted swap survives a restart.
     */
    signerStorage?: WalletStorage;
    /**
     * - Persists per-swap state (the preimage, keys, last response) for recovery/refund.
     */
    swapStorage?: SwapStorage;
    /**
     * - Override the satora API base URL. Defaults to the SDK's production endpoint.
     */
    baseUrl?: string;
    /**
     * - Override the Arkade server URL.
     */
    arkadeServerUrl?: string;
    /**
     * - Override the Esplora (Bitcoin) API URL.
     */
    esploraUrl?: string;
};
export type SatoraRefundOptions = {
    /**
     * - For an EVM-sourced swap: use the timelock-based refund (the account pays gas) instead of the gasless collaborative one. Ignored for Arkade/Bitcoin sources, whose other fields are forwarded as {@link RefundOptions}.
     */
    manual?: boolean;
};
export type SwidgeRoute = {
    /**
     * - The satora source chain id.
     */
    sourceChain: string;
    /**
     * - The source token id (`btc` or a contract address).
     */
    sourceToken: string;
    /**
     * - The satora destination chain id.
     */
    targetChain: string;
    /**
     * - The destination token id.
     */
    targetToken: string;
};
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
     * The satora protocol configuration.
     *
     * @protected
     * @type {SatoraProtocolConfig}
     */
    _config: SatoraProtocolConfig;
    /** @private */
    _clientPromise;
    /** @private */
    _signingClientPromise;
    /** @private */
    _evmSignerPromise;
    /** @private */
    _detectedChain;
    constructor(account?: undefined, config?: SatoraProtocolConfig);
    constructor(account: IWalletAccountReadOnly, config?: SatoraProtocolConfig);
    constructor(account: IWalletAccount, config?: SatoraProtocolConfig);
    /**
     * Lazily constructs (and memoizes) a read-only satora swap client, used for
     * discovery, quotes and status lookups.
     *
     * @protected
     * @returns {Promise<SatoraClient>} The satora swap client.
     */
    protected _getClient(): Promise<SatoraClient>;
    /**
     * Lazily constructs (and memoizes) the signing satora swap client, whose key
     * material (HTLC preimage + claim/refund keys) is derived from the wallet
     * account. Required by every fund-moving operation.
     *
     * @protected
     * @returns {Promise<SatoraClient>} The satora swap client.
     * @throws {SatoraInvalidOptionsError} If no account is bound or it cannot derive the swap key.
     */
    protected _getSigningClient(): Promise<SatoraClient>;
    /**
     * @private
     * @param {string} [xprv] - The swap client's key material; omitted for a read-only client.
     * @returns {Promise<SatoraClient>} The satora swap client.
     */
    private _buildClient;
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
    protected _resolveRoute(options: SwidgeOptions): Promise<SwidgeRoute>;
    /**
     * @private
     * @param {string} [qualified] - The chain prefix carried by `fromToken`, if any.
     * @returns {Promise<string>} The satora source chain id.
     */
    private _resolveSourceChain;
    /**
     * Detects the account's chain: Lightning accounts pay invoices, EVM accounts
     * report their chain id through their provider. Bitcoin and Arkade accounts
     * are indistinguishable and must declare `config.chain`.
     *
     * @private
     * @returns {Promise<string | undefined>} The satora chain id, if detectable.
     */
    private _detectAccountChain;
    /**
     * Adapts the bound account to the SDK's {@link EvmSigner} (memoized).
     *
     * @private
     * @param {string} chain - The EVM source chain id.
     * @returns {Promise<EvmSigner>} The signer.
     */
    private _getEvmSigner;
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
    quoteSwidge(options: SwidgeOptions): Promise<SwidgeQuote>;
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
    swidge(options: SwidgeOptions, config?: SwidgeProtocolConfig): Promise<SwidgeResult>;
    /** @private */
    private _swidgeArkadeToEvm;
    /** @private */
    private _swidgeBitcoinToEvm;
    /** @private */
    private _swidgeLightningToEvm;
    /** @private */
    private _swidgeEvmToArkade;
    /** @private */
    private _swidgeEvmToBitcoin;
    /** @private */
    private _swidgeEvmToLightning;
    /** @private */
    private _waitForSwapStatus;
    /** @private */
    private _completeSwap;
    /**
     * Retrieves the current status of an in-flight swidge.
     *
     * @param {string} id - The swidge execution identifier returned by swidge.
     * @param {SwidgeStatusOptions} [options] - Optional hints to assist provider lookups.
     * @returns {Promise<SwidgeStatusResult>} The current swidge status.
     * @throws {Error} If the id is invalid, or no swidge exists with the given identifier.
     */
    getSwidgeStatus(id: string, options?: SwidgeStatusOptions): Promise<SwidgeStatusResult>;
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
    resumeSwidge(id: string, options?: {
        timeoutMs?: number;
        intervalMs?: number;
    }): Promise<SwidgeStatusResult & {
        id: string;
    }>;
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
    refundSwidge(id: string, options?: SatoraRefundOptions): Promise<SwidgeStatusResult & {
        id: string;
        message?: string;
    }>;
    /**
     * Retrieves the chains supported by the provider for swidge operations.
     *
     * @returns {Promise<SwidgeSupportedChain[]>} The supported chains.
     */
    getSupportedChains(): Promise<SwidgeSupportedChain[]>;
    /**
     * Retrieves the tokens supported by the provider for swidge operations.
     * Each token's `token` is the provider id to pass as `fromToken`/`toToken`
     * (`btc`, or the ERC-20 contract address); `chain` carries its chain.
     *
     * @param {SwidgeSupportedTokensOptions} [options] - Optional filters for chain- or route-scoped token discovery.
     * @returns {Promise<SwidgeSupportedToken[]>} The supported tokens.
     */
    getSupportedTokens(options?: SwidgeSupportedTokensOptions): Promise<SwidgeSupportedToken[]>;
}
export type SwidgeFee = import('@tetherto/wdk-wallet/protocols').SwidgeFee;
