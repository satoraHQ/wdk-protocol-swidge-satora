import { jest, describe, test, expect } from '@jest/globals'

import { detectEvmChainId, isEvmSigner, toEvmSigner } from '../src/evm-signer.js'
import { SatoraInvalidOptionsError } from '../src/errors.js'

function wdkAccount (rpc = {}) {
  return {
    getAddress: jest.fn().mockResolvedValue('0xAccount'),
    signTypedData: jest.fn().mockResolvedValue('0xsig'),
    sendTransaction: jest.fn().mockResolvedValue({ hash: '0xhash', fee: 1n }),
    _provider: {
      send: jest.fn(async (method, params) => {
        if (method in rpc) return rpc[method](params)
        throw new Error(`unexpected ${method}`)
      })
    }
  }
}

describe('isEvmSigner', () => {
  test('recognises the SDK EvmSigner shape only', () => {
    expect(isEvmSigner({ address: '0x', signTypedData () {}, sendTransaction () {}, call () {}, waitForReceipt () {} })).toBe(true)
    expect(isEvmSigner(wdkAccount())).toBe(false)
    expect(isEvmSigner(undefined)).toBe(false)
  })
})

describe('detectEvmChainId', () => {
  test('reads chainId from an EvmSigner', async () => {
    expect(await detectEvmChainId({ chainId: 137 })).toBe(137)
  })

  test('asks a WDK account provider via eth_chainId', async () => {
    expect(await detectEvmChainId(wdkAccount({ eth_chainId: async () => '0x89' }))).toBe(137)
  })

  test('uses a configured RPC url when no provider is connected', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xa4b1' })
    })
    try {
      expect(await detectEvmChainId({ _config: { provider: 'https://rpc.example' } })).toBe(42161)
      expect(fetchSpy).toHaveBeenCalledWith('https://rpc.example', expect.objectContaining({ method: 'POST' }))
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('returns undefined for non-EVM accounts', async () => {
    expect(await detectEvmChainId({ getAddress: async () => 'bc1q' })).toBeUndefined()
    expect(await detectEvmChainId(wdkAccount())).toBeUndefined() // rpc throws
  })
})

describe('toEvmSigner', () => {
  test('returns an EvmSigner untouched', async () => {
    const signer = { address: '0x', signTypedData () {}, sendTransaction () {}, call () {}, waitForReceipt () {} }
    expect(await toEvmSigner(signer, 1)).toBe(signer)
  })

  test('rejects accounts that cannot sign EVM transactions', async () => {
    await expect(toEvmSigner({ getAddress: async () => 'x' }, 1)).rejects.toThrow(SatoraInvalidOptionsError)
  })

  test('rejects a WDK account without a provider', async () => {
    const account = wdkAccount()
    account._provider = undefined
    await expect(toEvmSigner(account, 1)).rejects.toThrow(/provider/)
  })

  test('adapts a WDK EVM account: signs and sends through the account, reads through its provider', async () => {
    const account = wdkAccount({
      eth_getTransactionReceipt: async () => ({ status: '0x1', blockNumber: '0x1a', transactionHash: '0xhash' }),
      eth_getTransactionByHash: async () => ({ to: '0xto', input: '0xinput', from: '0xAccount' }),
      eth_call: async (params) => `0xcalled:${params[0].to}:${params[1]}`
    })

    const signer = await toEvmSigner(account, 42161)

    expect(signer.address).toBe('0xAccount')
    expect(signer.chainId).toBe(42161)

    // EIP712Domain is stripped: ethers derives it from the domain itself.
    await signer.signTypedData({
      domain: { name: 'X' },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }], Msg: [{ name: 'a', type: 'uint256' }] },
      primaryType: 'Msg',
      message: { a: 1n }
    })
    expect(account.signTypedData).toHaveBeenCalledWith({ domain: { name: 'X' }, types: { Msg: [{ name: 'a', type: 'uint256' }] }, message: { a: 1n } })

    await expect(signer.sendTransaction({ to: '0xto', data: '0xdata' })).resolves.toBe('0xhash')
    expect(account.sendTransaction).toHaveBeenCalledWith({ to: '0xto', data: '0xdata', value: 0n })

    await expect(signer.waitForReceipt('0xhash')).resolves.toEqual({ status: 'success', blockNumber: 26n, transactionHash: '0xhash' })
    await expect(signer.getTransaction('0xhash')).resolves.toEqual({ to: '0xto', input: '0xinput', from: '0xAccount' })
    await expect(signer.call({ to: '0xto', data: '0xdata', blockNumber: 255n })).resolves.toBe('0xcalled:0xto:0xff')
    await expect(signer.call({ to: '0xto', data: '0xdata' })).resolves.toBe('0xcalled:0xto:latest')
  })

  test('reports a reverted receipt', async () => {
    const account = wdkAccount({ eth_getTransactionReceipt: async () => ({ status: '0x0', blockNumber: '0x2' }) })
    const signer = await toEvmSigner(account, 1)
    await expect(signer.waitForReceipt('0xh')).resolves.toEqual({ status: 'reverted', blockNumber: 2n, transactionHash: '0xh' })
  })
})
