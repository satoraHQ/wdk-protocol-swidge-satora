export type EvmSigner = import('@satora/swap').EvmSigner;
export type IWalletAccount = import('@tetherto/wdk-wallet').IWalletAccount;
export type JsonRpc = (method: string, params: unknown[]) => Promise<any>;
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
export declare function isEvmSigner(account: Object): boolean;
/**
 * Detects the EVM chain id the account is connected to: an {@link EvmSigner}
 * carries it as `chainId`; a WDK EVM account is asked through its provider
 * (`eth_chainId`). Returns undefined for non-EVM accounts.
 *
 * @param {Object} account - The account.
 * @returns {Promise<number | undefined>} The chain id, if detectable.
 */
export declare function detectEvmChainId(account: Object): Promise<number | undefined>;
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
export declare function toEvmSigner(account: IWalletAccount | EvmSigner | Object, chainId: number): Promise<EvmSigner>;
