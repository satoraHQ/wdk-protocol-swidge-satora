export type WalletStorage = import('@satora/swap').WalletStorage;
export type SwapStorage = import('@satora/swap').SwapStorage;
/** @typedef {import('@satora/swap').WalletStorage} WalletStorage */
/** @typedef {import('@satora/swap').SwapStorage} SwapStorage */
/**
 * The SDK's `WalletStorage`, backed by the swap storage. The swap key itself
 * is derived from the wallet account on every run, so nothing secret is ever
 * persisted here; the only state the SDK needs is the next per-swap key
 * index, and every stored swap already records the index it used. The next
 * index is therefore one past the highest stored index (or a higher floor set
 * during this session, e.g. after a hash-collision skip or a recovery scan).
 *
 * Without a swap storage the index is session-local, which is why fund-moving
 * operations require one: a deterministic key with a resetting index would
 * reuse preimages across runs.
 *
 * @implements {WalletStorage}
 */
export declare class SwapKeyIndexStorage implements WalletStorage {
    /** @private */
    _swapStorage;
    /** @private */
    _floor;
    /**
     * @param {SwapStorage} [swapStorage] - The swap storage, if configured.
     */
    constructor(swapStorage?: SwapStorage);
    /** The key is never stored. */
    getMnemonic(): Promise<null>;
    /** The key is never stored. */
    setMnemonic(): Promise<void>;
    /**
     * @returns {Promise<number>} The next unused key index.
     */
    getKeyIndex(): Promise<number>;
    /**
     * @param {number} index - The new key index (a floor for this session).
     */
    setKeyIndex(index: number): Promise<void>;
    /**
     * @returns {Promise<number>} The index to use; the next one is reserved.
     */
    incrementKeyIndex(): Promise<number>;
    clear(): Promise<void>;
    /**
     * @private
     * @returns {Promise<number>} One past the highest key index recorded in the swap storage.
     */
    private _nextStoredIndex;
}
