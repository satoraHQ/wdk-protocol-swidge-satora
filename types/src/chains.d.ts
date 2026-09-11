export type SwidgeSupportedChain = import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain;
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
export declare const CHAIN_METADATA: Record<string, SwidgeSupportedChain>;
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
export declare function normalizeChain(chain: string | number): string;
/**
 * Returns true if the chain identifier is an EVM chain (a numeric id).
 *
 * @param {string | number} chain - The chain identifier.
 * @returns {boolean}
 */
export declare function isEvmChain(chain: string | number): boolean;
/**
 * Normalizes a satora `Chain` identifier to the WDK chain id form: EVM chains
 * (encoded as numeric strings) become numbers, non-EVM chains stay as their
 * name. This is the canonical id surfaced by {@link toSupportedChain} and used
 * for `chain` fields and route-scoped filtering.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {string | number} The normalized chain id.
 */
export declare function toChainId(sdkChain: string | number): string | number;
/**
 * Maps a satora `Chain` identifier to a WDK {@link SwidgeSupportedChain}.
 * Unknown identifiers fall back to a best-effort mapping: numeric ids are
 * treated as EVM chains, everything else as 'other'.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {SwidgeSupportedChain} The WDK supported-chain descriptor.
 */
export declare function toSupportedChain(sdkChain: string | number): SwidgeSupportedChain;
