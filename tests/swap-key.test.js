import { jest, describe, test, expect } from '@jest/globals'

import { deriveSwapXprv } from '../src/swap-key.js'
import { SatoraInvalidOptionsError } from '../src/errors.js'

const KEY = new Uint8Array(32).fill(9)

describe('deriveSwapXprv', () => {
  test('derives a deterministic xprv from the account key pair', async () => {
    const a = await deriveSwapXprv({ keyPair: { privateKey: KEY } })
    const b = await deriveSwapXprv({ keyPair: { privateKey: KEY } })

    expect(a).toMatch(/^xprv/)
    expect(a).toBe(b)
  })

  test('accepts a hex-encoded private key and yields the same key as the bytes', async () => {
    const hex = '0x' + Array.from(KEY, byte => byte.toString(16).padStart(2, '0')).join('')
    expect(await deriveSwapXprv({ keyPair: { privateKey: hex } })).toBe(await deriveSwapXprv({ keyPair: { privateKey: KEY } }))
  })

  test('different account keys yield different swap keys', async () => {
    const other = new Uint8Array(32).fill(10)
    expect(await deriveSwapXprv({ keyPair: { privateKey: KEY } })).not.toBe(await deriveSwapXprv({ keyPair: { privateKey: other } }))
  })

  test('falls back to sign(message) when the key pair is unavailable', async () => {
    const account = { get keyPair () { throw new Error('not implemented') }, sign: jest.fn().mockResolvedValue('0xsignature') }

    const xprv = await deriveSwapXprv(account)

    expect(account.sign).toHaveBeenCalledWith(expect.stringContaining('Satora swap key'))
    expect(xprv).toMatch(/^xprv/)
    expect(await deriveSwapXprv(account)).toBe(xprv)
  })

  test('falls back to signTypedData for a raw EvmSigner', async () => {
    const signer = { signTypedData: jest.fn().mockResolvedValue('0xtyped') }

    const xprv = await deriveSwapXprv(signer)

    expect(signer.signTypedData).toHaveBeenCalledWith(expect.objectContaining({ primaryType: 'SwapKey' }))
    expect(xprv).toMatch(/^xprv/)
  })

  test('throws for an account with no usable key material', async () => {
    await expect(deriveSwapXprv({ getAddress: async () => 'x' })).rejects.toThrow(SatoraInvalidOptionsError)
    await expect(deriveSwapXprv({ keyPair: { privateKey: null } })).rejects.toThrow(SatoraInvalidOptionsError)
  })
})
