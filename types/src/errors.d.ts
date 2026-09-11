/**
 * Thrown for invalid or missing arguments/configuration passed to the satora
 * protocol (e.g. a missing source chain or swap amount).
 */
export declare class SatoraInvalidOptionsError extends Error {
    /**
     * @param {string} message - The error message.
     */
    constructor(message: string);
}
/**
 * Thrown by `swidge` when the amount the swap would deliver is below the
 * caller's `minAmountOut` guard. Raised before any funds move: the created
 * swap is left unfunded and simply expires.
 */
export declare class SatoraMinAmountOutError extends Error {
    swapId: string;
    toTokenAmount: bigint;
    minAmountOut: bigint;
    /**
     * @param {string} swapId - The id of the (unfunded) swap.
     * @param {bigint} toTokenAmount - The amount the swap would deliver.
     * @param {bigint} minAmountOut - The caller's minimum.
     */
    constructor(swapId: string, toTokenAmount: bigint, minAmountOut: bigint);
}
