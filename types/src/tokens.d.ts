export type SwidgeSupportedToken = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken;
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
export declare function parseTokenId(token: string): {
    chain: string | undefined;
    tokenId: string;
};
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
export declare function toSupportedToken(info: {
    token_id: string;
    chain: string | number;
    symbol: string;
    decimals: number;
    name: string;
}): SwidgeSupportedToken;
