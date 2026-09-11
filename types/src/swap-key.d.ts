export type IWalletAccount = import('@tetherto/wdk-wallet').IWalletAccount;
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
export declare function deriveSwapXprv(account: IWalletAccount | Object): Promise<string>;
