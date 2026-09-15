import { describe, test, expect } from '@jest/globals'

import { SwapKeyIndexStorage } from '../src/key-index-storage.js'

function swapStorageWith (indexes) {
  const swaps = new Map(indexes.map((keyIndex, i) => [`swap-${i}`, { swapId: `swap-${i}`, keyIndex }]))
  return { list: async () => [...swaps.keys()], get: async (id) => swaps.get(id) ?? null }
}

describe('SwapKeyIndexStorage', () => {
  test('never stores or returns a mnemonic', async () => {
    const storage = new SwapKeyIndexStorage(swapStorageWith([]))
    await storage.setMnemonic('abandon abandon')
    await expect(storage.getMnemonic()).resolves.toBeNull()
  })

  test('the next index is one past the highest stored swap index', async () => {
    const storage = new SwapKeyIndexStorage(swapStorageWith([0, 3, 1]))
    await expect(storage.getKeyIndex()).resolves.toBe(4)
  })

  test('starts at 0 with no stored swaps or no swap storage', async () => {
    await expect(new SwapKeyIndexStorage(swapStorageWith([])).getKeyIndex()).resolves.toBe(0)
    await expect(new SwapKeyIndexStorage().getKeyIndex()).resolves.toBe(0)
  })

  test('incrementKeyIndex hands out consecutive indexes within a session', async () => {
    const storage = new SwapKeyIndexStorage(swapStorageWith([2]))
    await expect(storage.incrementKeyIndex()).resolves.toBe(3)
    await expect(storage.incrementKeyIndex()).resolves.toBe(4)
    await expect(storage.getKeyIndex()).resolves.toBe(5)
  })

  test('setKeyIndex raises the floor (recovery / collision skip) but never goes below stored swaps', async () => {
    const storage = new SwapKeyIndexStorage(swapStorageWith([2]))
    await storage.setKeyIndex(10)
    await expect(storage.getKeyIndex()).resolves.toBe(10)
    await storage.setKeyIndex(1)
    await expect(storage.getKeyIndex()).resolves.toBe(3)
  })

  test('ignores stored swaps without a numeric key index', async () => {
    const storage = new SwapKeyIndexStorage({ list: async () => ['a', 'b'], get: async (id) => id === 'a' ? { keyIndex: 'x' } : null })
    await expect(storage.getKeyIndex()).resolves.toBe(0)
  })
})
