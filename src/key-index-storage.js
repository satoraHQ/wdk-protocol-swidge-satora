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
export class SwapKeyIndexStorage {
  /**
   * @param {SwapStorage} [swapStorage] - The swap storage, if configured.
   */
  constructor (swapStorage) {
    /** @private */
    this._swapStorage = swapStorage

    /** @private */
    this._floor = 0
  }

  /** The key is never stored. */
  async getMnemonic () {
    return null
  }

  /** The key is never stored. */
  async setMnemonic () {}

  /**
   * @returns {Promise<number>} The next unused key index.
   */
  async getKeyIndex () {
    return Math.max(this._floor, await this._nextStoredIndex())
  }

  /**
   * @param {number} index - The new key index (a floor for this session).
   */
  async setKeyIndex (index) {
    this._floor = index
  }

  /**
   * @returns {Promise<number>} The index to use; the next one is reserved.
   */
  async incrementKeyIndex () {
    const index = await this.getKeyIndex()
    this._floor = index + 1
    return index
  }

  async clear () {
    this._floor = 0
  }

  /**
   * @private
   * @returns {Promise<number>} One past the highest key index recorded in the swap storage.
   */
  async _nextStoredIndex () {
    if (!this._swapStorage) return 0
    let highest = -1
    for (const swapId of await this._swapStorage.list()) {
      const stored = await this._swapStorage.get(swapId)
      if (stored && Number.isInteger(stored.keyIndex) && stored.keyIndex > highest) highest = stored.keyIndex
    }
    return highest + 1
  }
}
