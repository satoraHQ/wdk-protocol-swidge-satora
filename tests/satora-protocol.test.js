import { jest, describe, test, expect, beforeEach } from '@jest/globals'

// Mock the satora swap client so the protocol can be exercised without a
// network, a mnemonic, or storage.
const mockClient = {
  getSwapPairs: jest.fn(),
  getTokens: jest.fn(),
  getQuote: jest.fn(),
  createArkadeToEvmSwapGeneric: jest.fn(),
  createBitcoinToEvmSwap: jest.fn(),
  createEvmToArkadeSwapGeneric: jest.fn(),
  createEvmToBitcoinSwap: jest.fn(),
  createEvmToLightningSwap: jest.fn(),
  createLightningToEvmSwap: jest.fn(),
  fundSwap: jest.fn(),
  getSwap: jest.fn(),
  claim: jest.fn(),
  refundSwap: jest.fn(),
  refundEvmWithSigner: jest.fn(),
  collabRefundEvmWithSigner: jest.fn()
}

const builderCalls = { withXprv: jest.fn() }

jest.unstable_mockModule('@satora/swap', () => ({
  Client: {
    builder: () => {
      const builder = {
        withBaseUrl: () => builder,
        withArkadeServerUrl: () => builder,
        withEsploraUrl: () => builder,
        withSignerStorage: () => builder,
        withSwapStorage: () => builder,
        withXprv: (xprv) => { builderCalls.withXprv(xprv); return builder },
        build: async () => mockClient
      }
      return builder
    }
  }
}))

const { default: SatoraProtocol, SatoraInvalidOptionsError, SatoraMinAmountOutError } = await import('../index.js')

// A 32-byte private key: WDK accounts expose it via `keyPair`, and the protocol
// derives the swap key from it (no separate mnemonic).
const PRIVATE_KEY = new Uint8Array(32).fill(7)

// A WDK EVM wallet account connected to an Arbitrum provider.
function evmAccount (overrides = {}) {
  return {
    keyPair: { privateKey: PRIVATE_KEY, publicKey: new Uint8Array(33) },
    getAddress: jest.fn().mockResolvedValue('0xEvmAccount'),
    signTypedData: jest.fn().mockResolvedValue('0xsig'),
    sendTransaction: jest.fn().mockResolvedValue({ hash: '0xtx', fee: 1n }),
    _provider: {
      send: jest.fn(async (method, params) => {
        if (method === 'eth_chainId') return '0xa4b1' // 42161
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x10', transactionHash: params[0] }
        if (method === 'eth_getTransactionByHash') return { to: '0xhtlc', input: '0xdata', from: '0xEvmAccount' }
        if (method === 'eth_call') return '0x01'
        throw new Error(`unexpected rpc ${method}`)
      })
    },
    ...overrides
  }
}

describe('@satora/wdk-protocol-swidge-satora', () => {
  let protocol

  beforeEach(() => {
    for (const fn of Object.values(mockClient)) fn.mockReset()
    builderCalls.withXprv.mockReset()

    // Discovery methods do not require an account.
    protocol = new SatoraProtocol()
  })

  describe('quoteSwidge', () => {
    const quoteResponse = {
      exchange_rate: '0.0000004',
      gasless_network_fee: 500,
      network_fee: 1000,
      protocol_fee: 250,
      protocol_fee_rate: 0.0025,
      bridge_fee: null,
      net_source_amount: '1000000',
      net_target_amount: '40000',
      source_amount: '1000000',
      target_amount: '40000'
    }

    beforeEach(() => {
      mockClient.getQuote.mockResolvedValue(quoteResponse)
    })

    test('takes the source chain from config.chain and the destination from toChain (exact-in, BigInt)', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 42161 })

      const quote = await protocol.quoteSwidge({
        fromToken: '0xusdt0',
        toToken: 'btc',
        toChain: 'Bitcoin',
        fromTokenAmount: 1000000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: '42161',
        sourceToken: '0xusdt0',
        targetChain: 'Bitcoin',
        targetToken: 'btc',
        sourceAmount: 1000000n
      })

      expect(quote.fromTokenAmount).toBe(1000000n)
      expect(quote.toTokenAmount).toBe(40000n)
      expect(quote.toTokenAmountMin).toBe(40000n) // no slippage configured
      expect(quote.fees).toEqual([
        { type: 'protocol', amount: 250n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Protocol fee (rate 0.0025)' },
        { type: 'network', amount: 1000n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Network fee (HTLC create/claim + BTC mining)' },
        { type: 'network', amount: 500n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Gasless DEX execution gas' }
      ])
    })

    test('quotes exact-out (passes targetAmount, not sourceAmount)', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 'Bitcoin' })

      const quote = await protocol.quoteSwidge({
        fromToken: 'btc',
        toToken: '0xusdt0',
        toChain: 42161,
        toTokenAmount: 40000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: 'Bitcoin',
        sourceToken: 'btc',
        targetChain: '42161',
        targetToken: '0xusdt0',
        targetAmount: 40000n
      })
      expect(quote.toTokenAmount).toBe(40000n)
    })

    test('derives the source chain from a WDK EVM account (eth_chainId) when config.chain is not set', async () => {
      protocol = new SatoraProtocol(evmAccount())

      await protocol.quoteSwidge({ fromToken: '0xusdt0', toToken: 'btc', toChain: 'Arkade', fromTokenAmount: 10n })

      expect(mockClient.getQuote).toHaveBeenCalledWith(expect.objectContaining({ sourceChain: '42161', targetChain: 'Arkade' }))
    })

    test('derives Lightning from an account that pays invoices', async () => {
      protocol = new SatoraProtocol({ payLightningInvoice: jest.fn() })

      await protocol.quoteSwidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 10n })

      expect(mockClient.getQuote).toHaveBeenCalledWith(expect.objectContaining({ sourceChain: 'Lightning', sourceToken: 'btc' }))
    })

    test('still accepts chain-qualified token ids', async () => {
      await protocol.quoteSwidge({ fromToken: 'Lightning:btc', toToken: '42161:0xusdt0', fromTokenAmount: 1000000n })

      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: 'Lightning',
        sourceToken: 'btc',
        targetChain: '42161',
        targetToken: '0xusdt0',
        sourceAmount: 1000000n
      })
    })

    test('defaults the destination chain to the source chain', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 42161 })
      await protocol.quoteSwidge({ fromToken: '0xusdt0', toToken: '0xusdc', fromTokenAmount: 10n })
      expect(mockClient.getQuote).toHaveBeenCalledWith(expect.objectContaining({ sourceChain: '42161', targetChain: '42161' }))
    })

    test('applies slippage (option, then config.defaultSlippage) to the minimum', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 42161 })
      const withOption = await protocol.quoteSwidge({
        fromToken: '0xusdt0', toToken: 'btc', toChain: 'Bitcoin', fromTokenAmount: 1000000n, slippage: 0.01
      })
      expect(withOption.toTokenAmountMin).toBe(39600n) // 40000 - 1%

      protocol = new SatoraProtocol(undefined, { chain: 42161, defaultSlippage: 0.005 })
      const withConfig = await protocol.quoteSwidge({
        fromToken: '0xusdt0', toToken: 'btc', toChain: 'Bitcoin', fromTokenAmount: 1000000n
      })
      expect(withConfig.toTokenAmountMin).toBe(39800n) // 40000 - 0.5%
    })

    test('throws when the source chain cannot be determined', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 1000000n })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.getQuote).not.toHaveBeenCalled()
    })

    test('throws when a chain-qualified fromToken contradicts config.chain', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 'Bitcoin' })
      await expect(
        protocol.quoteSwidge({ fromToken: 'Lightning:btc', toToken: '42161:0xusdt0', fromTokenAmount: 1n })
      ).rejects.toThrow(/config\.chain/)
    })

    test('throws for an unknown chain', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 'Solana' })
      await expect(
        protocol.quoteSwidge({ fromToken: 'sol', toToken: 'btc', toChain: 'Bitcoin', fromTokenAmount: 1n })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws when no amount is given', async () => {
      protocol = new SatoraProtocol(undefined, { chain: 42161 })
      await expect(
        protocol.quoteSwidge({ fromToken: '0xusdt0', toToken: 'btc', toChain: 'Bitcoin' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.getQuote).not.toHaveBeenCalled()
    })
  })

  describe('swidge (Arkade -> EVM)', () => {
    let account

    const createResponse = {
      response: {
        id: 'swap-1',
        btc_vhtlc_address: 'ark1qvhtlc',
        source_amount: '100000',
        target_amount: '58000000',
        fee_sats: 250,
        evm_claim_txid: null
      }
    }

    beforeEach(() => {
      account = {
        keyPair: { privateKey: PRIVATE_KEY },
        getAddress: jest.fn().mockResolvedValue('ark1qsource'),
        sendTransaction: jest.fn().mockResolvedValue({ hash: '0xfundtx', fee: 100n })
      }
      protocol = new SatoraProtocol(account, { chain: 'Arkade' })

      mockClient.createArkadeToEvmSwapGeneric.mockResolvedValue(createResponse)
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded', evm_claim_txid: null })
        .mockResolvedValueOnce({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim' })
    })

    test('drives an Arkade -> EVM swap end to end (create, fund, claim)', async () => {
      const result = await protocol.swidge({
        fromToken: 'btc',
        toToken: '0xusdt0',
        toChain: 42161,
        fromTokenAmount: 100000n,
        recipient: '0xRecipient'
      })

      // The swap key is derived from the account, never from a mnemonic.
      expect(builderCalls.withXprv).toHaveBeenCalledTimes(1)
      expect(builderCalls.withXprv.mock.calls[0][0]).toMatch(/^xprv/)

      // Create with the resolved route + recipient as the target address.
      expect(mockClient.createArkadeToEvmSwapGeneric).toHaveBeenCalledWith({
        targetAddress: '0xRecipient',
        tokenAddress: '0xusdt0',
        evmChainId: 42161,
        sourceAmount: 100000n
      })

      // The account funds the returned VHTLC with the server-confirmed amount.
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: 'ark1qvhtlc', value: 100000n })

      // Gasless claim by swap id.
      expect(mockClient.claim).toHaveBeenCalledWith('swap-1', undefined)

      expect(result).toEqual({
        id: 'swap-1',
        hash: '0xevmclaim',
        fromTokenAmount: 100000n,
        toTokenAmount: 58000000n,
        toTokenAmountMin: 58000000n,
        fees: [
          { type: 'protocol', amount: 250n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }
        ],
        transactions: [
          { hash: '0xfundtx', chain: 'Arkade', type: 'source' },
          { hash: '0xevmclaim', chain: 42161, type: 'destination' }
        ]
      })
    })

    test('honours minAmountOut: refuses to fund a swap that would deliver less', async () => {
      await expect(
        protocol.swidge({
          fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR', minAmountOut: 58000001n
        })
      ).rejects.toThrow(SatoraMinAmountOutError)

      expect(mockClient.createArkadeToEvmSwapGeneric).toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
      expect(mockClient.claim).not.toHaveBeenCalled()
    })

    test('reports minAmountOut as toTokenAmountMin when satisfied', async () => {
      const result = await protocol.swidge({
        fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR', minAmountOut: 57000000n
      })
      expect(result.toTokenAmountMin).toBe(57000000n)
    })

    test('throws if the account cannot send (read-only or missing)', async () => {
      const readOnly = new SatoraProtocol({ getAddress: jest.fn(), keyPair: { privateKey: PRIVATE_KEY } }, { chain: 'Arkade' })
      await expect(
        readOnly.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createArkadeToEvmSwapGeneric).not.toHaveBeenCalled()
    })

    test('throws if no account is bound', async () => {
      const noAccount = new SatoraProtocol(undefined, { chain: 'Arkade' })
      await expect(
        noAccount.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws if recipient is missing', async () => {
      await expect(
        protocol.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws if the account cannot derive the swap key', async () => {
      const bare = new SatoraProtocol({ getAddress: jest.fn(), sendTransaction: jest.fn() }, { chain: 'Arkade' })
      await expect(
        bare.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow(/swap key/)
      expect(mockClient.createArkadeToEvmSwapGeneric).not.toHaveBeenCalled()
    })

    test('throws for an unsupported direction (Arkade -> Bitcoin)', async () => {
      await expect(
        protocol.swidge({ fromToken: 'btc', toToken: 'btc', toChain: 'Bitcoin', fromTokenAmount: 100000n, recipient: 'bc1q' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws if the gasless claim fails', async () => {
      mockClient.claim.mockResolvedValue({ success: false, message: 'boom' })
      await expect(
        protocol.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow('boom')
    })
  })

  describe('swidge (EVM -> Arkade)', () => {
    let account

    beforeEach(() => {
      account = evmAccount()
      protocol = new SatoraProtocol(account)

      mockClient.createEvmToArkadeSwapGeneric.mockResolvedValue({
        response: { id: 'swap-2', source_amount: '1000000', target_amount: '1450', fee_sats: 30, btc_claim_txid: null }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', direction: 'evm_to_arkade', evm_chain_id: 42161, evm_fund_txid: '0xfundtx', btc_claim_txid: 'btcclaim' })
    })

    test('creates, funds the EVM HTLC with the WDK account, and settles to Arkade', async () => {
      const result = await protocol.swidge({
        fromToken: '0xusdt0',
        toToken: 'btc',
        toChain: 'Arkade',
        fromTokenAmount: 1000000n,
        recipient: 'ark1qdest'
      })

      // The source chain came from the account's provider.
      expect(mockClient.createEvmToArkadeSwapGeneric).toHaveBeenCalledWith({
        targetAddress: 'ark1qdest',
        tokenAddress: '0xusdt0',
        evmChainId: 42161,
        userAddress: '0xEvmAccount',
        sourceAmount: 1000000n
      })

      // The account is adapted to the SDK's EvmSigner: fundSwap signs and sends through it.
      const [swapId, signer] = mockClient.fundSwap.mock.calls[0]
      expect(swapId).toBe('swap-2')
      expect(signer.address).toBe('0xEvmAccount')
      expect(signer.chainId).toBe(42161)
      await expect(signer.sendTransaction({ to: '0xhtlc', data: '0xdata', gas: 100000n })).resolves.toBe('0xtx')
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: '0xhtlc', data: '0xdata', value: 0n, gasLimit: 100000n })
      await expect(signer.waitForReceipt('0xtx')).resolves.toEqual({ status: 'success', blockNumber: 16n, transactionHash: '0xtx' })

      expect(result).toEqual({
        id: 'swap-2',
        hash: 'btcclaim',
        fromTokenAmount: 1000000n,
        toTokenAmount: 1450n,
        toTokenAmountMin: 1450n,
        fees: [{ type: 'protocol', amount: 30n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [
          { hash: '0xfundtx', chain: 42161, type: 'source' },
          { hash: 'btcclaim', chain: 'Arkade', type: 'destination' }
        ]
      })
    })

    test('passes a ready-made EvmSigner through untouched', async () => {
      const signer = {
        address: '0xSigner',
        chainId: 42161,
        signTypedData: jest.fn().mockResolvedValue('0xsig'),
        sendTransaction: jest.fn(),
        call: jest.fn(),
        waitForReceipt: jest.fn(),
        getTransaction: jest.fn()
      }
      protocol = new SatoraProtocol(signer)

      await protocol.swidge({ fromToken: '0xusdt0', toToken: 'btc', toChain: 'Arkade', fromTokenAmount: 1000000n, recipient: 'ark1qdest' })

      expect(mockClient.createEvmToArkadeSwapGeneric).toHaveBeenCalledWith(expect.objectContaining({ userAddress: '0xSigner', evmChainId: 42161 }))
      expect(mockClient.fundSwap).toHaveBeenCalledWith('swap-2', signer)
      // No keyPair / sign: the swap key was derived from a fixed typed-data signature.
      expect(signer.signTypedData).toHaveBeenCalled()
      expect(builderCalls.withXprv).toHaveBeenCalledTimes(1)
    })

    test('rejects a source chain that contradicts the account chain', async () => {
      const wrong = new SatoraProtocol(account, { chain: 'Arkade' })
      await expect(
        wrong.swidge({ fromToken: '42161:0xusdt0', toToken: 'Arkade:btc', fromTokenAmount: 1000000n, recipient: 'ark1qdest' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createEvmToArkadeSwapGeneric).not.toHaveBeenCalled()
    })

    test('throws if the EVM account has no provider', async () => {
      const offline = new SatoraProtocol(evmAccount({ _provider: undefined }), { chain: 42161 })
      await expect(
        offline.swidge({ fromToken: '0xusdt0', toToken: 'btc', toChain: 'Arkade', fromTokenAmount: 1000000n, recipient: 'ark1qdest' })
      ).rejects.toThrow(/provider/)
    })
  })

  describe('swidge (Lightning -> EVM)', () => {
    let account

    beforeEach(() => {
      // A WDK Spark account: pays the swap's BOLT11 invoice.
      account = {
        keyPair: { privateKey: PRIVATE_KEY },
        payLightningInvoice: jest.fn().mockResolvedValue({ id: 'payment' })
      }
      protocol = new SatoraProtocol(account, { lightningMaxFeeSats: 50 })

      mockClient.createLightningToEvmSwap.mockResolvedValue({
        response: { id: 'swap-3', bolt11_invoice: 'lnbc1invoice', source_amount: '1000', target_amount: '580000', fee_sats: 10, evm_claim_txid: null }
      })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaim' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim', evm_chain_id: 42161 })
    })

    test('creates, pays the BOLT11 invoice, and settles to EVM', async () => {
      const result = await protocol.swidge({
        fromToken: 'btc',
        toToken: '0xusdt0',
        toChain: 42161,
        fromTokenAmount: 1000n,
        recipient: '0xRecipient'
      })

      expect(mockClient.createLightningToEvmSwap).toHaveBeenCalledWith({
        targetAddress: '0xRecipient',
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        sourceAmount: 1000
      })
      expect(account.payLightningInvoice).toHaveBeenCalledWith({ invoice: 'lnbc1invoice', maxFeeSats: 50 })

      expect(result).toEqual({
        id: 'swap-3',
        hash: '0xevmclaim',
        fromTokenAmount: 1000n,
        toTokenAmount: 580000n,
        toTokenAmountMin: 580000n,
        fees: [{ type: 'protocol', amount: 10n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [{ hash: '0xevmclaim', chain: 42161, type: 'destination' }]
      })
    })

    test('also accepts a generic payInvoice(bolt11) account', async () => {
      const generic = { keyPair: { privateKey: PRIVATE_KEY }, payInvoice: jest.fn().mockResolvedValue({}) }
      protocol = new SatoraProtocol(generic)

      await protocol.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 1000n, recipient: '0xR' })

      expect(generic.payInvoice).toHaveBeenCalledWith('lnbc1invoice')
    })

    test('fails fast when the invoice payment fails (e.g. no funds)', async () => {
      account.payLightningInvoice.mockRejectedValue(new Error('insufficient balance'))
      // Completion would otherwise poll forever; make it stay in-flight.
      mockClient.getSwap.mockReset().mockResolvedValue({ status: 'clientfunded' })

      await expect(
        protocol.swidge({ fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 1000n, recipient: '0xR' })
      ).rejects.toThrow(/lightning payment failed: insufficient balance/)
    })
  })

  describe('swidge (EVM -> Lightning)', () => {
    let account

    beforeEach(() => {
      account = evmAccount()
      protocol = new SatoraProtocol(account)

      mockClient.createEvmToLightningSwap.mockResolvedValue({
        response: { id: 'swap-4', source_amount: '1000000', target_amount: '900', fee_sats: 20, evm_fund_txid: null }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      // Server pays the invoice and claims the EVM HTLC — terminal, no client claim.
      mockClient.getSwap.mockResolvedValue({ status: 'serverredeemed' })
    })

    test('creates against the invoice, funds the EVM HTLC, and never claims (server does)', async () => {
      const result = await protocol.swidge({
        fromToken: '0xusdt0',
        toToken: 'btc',
        toChain: 'Lightning',
        recipient: 'lnbc10u1invoice'
      })

      expect(mockClient.createEvmToLightningSwap).toHaveBeenCalledWith({
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        userAddress: '0xEvmAccount',
        lightningInvoice: 'lnbc10u1invoice'
      })
      expect(mockClient.fundSwap.mock.calls[0][0]).toBe('swap-4')
      expect(mockClient.claim).not.toHaveBeenCalled()

      expect(result).toEqual({
        id: 'swap-4',
        hash: '0xfundtx',
        fromTokenAmount: 1000000n,
        toTokenAmount: 900n,
        toTokenAmountMin: 900n,
        fees: [{ type: 'protocol', amount: 20n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [{ hash: '0xfundtx', chain: 42161, type: 'source' }]
      })
    })

    test('sends to a lightning address with an explicit sats payout', async () => {
      await protocol.swidge({
        fromToken: '0xusdt0',
        toToken: 'btc',
        toChain: 'Lightning',
        recipient: 'user@speed.app',
        toTokenAmount: 900n
      })

      expect(mockClient.createEvmToLightningSwap).toHaveBeenCalledWith({
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        userAddress: '0xEvmAccount',
        lightningAddress: 'user@speed.app',
        targetAmountSats: 900
      })
    })

    test('throws for a lightning address without an amount', async () => {
      await expect(
        protocol.swidge({ fromToken: '0xusdt0', toToken: 'btc', toChain: 'Lightning', recipient: 'user@speed.app' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createEvmToLightningSwap).not.toHaveBeenCalled()
    })

    test('a lightning address payout uses the destination sats (toTokenAmount), not the source token amount', async () => {
      // fromTokenAmount is the EVM source (1 USDT0 = 1_000_000 in 6 decimals);
      // the Lightning payout is the destination amount in sats. Paying to a
      // lightning address should charge 1500 sats, NOT 1_000_000 sats (~0.01 BTC).
      await protocol.swidge({
        fromToken: '0xusdt0',
        toToken: 'btc',
        toChain: 'Lightning',
        recipient: 'user@speed.app',
        fromTokenAmount: 1000000n,
        toTokenAmount: 1500n
      })

      expect(mockClient.createEvmToLightningSwap).toHaveBeenCalledWith({
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        userAddress: '0xEvmAccount',
        lightningAddress: 'user@speed.app',
        targetAmountSats: 1500
      })
    })
  })

  describe('swidge (Bitcoin <-> EVM, on-chain)', () => {
    test('Bitcoin -> EVM funds the on-chain HTLC and claims (gasless)', async () => {
      const account = {
        keyPair: { privateKey: PRIVATE_KEY },
        getAddress: jest.fn().mockResolvedValue('bc1qsource'),
        sendTransaction: jest.fn().mockResolvedValue({ hash: 'btcfundtx' })
      }
      protocol = new SatoraProtocol(account, { chain: 'Bitcoin' })

      mockClient.createBitcoinToEvmSwap.mockResolvedValue({
        response: { id: 'swap-5', btc_htlc_address: 'bc1qhtlc', source_amount: '200000', target_amount: '116000000', fee_sats: 400 }
      })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim', evm_chain_id: 42161 })

      const result = await protocol.swidge({
        fromToken: 'btc', toToken: '0xusdt0', toChain: 42161, fromTokenAmount: 200000n, recipient: '0xRecipient'
      })

      expect(mockClient.createBitcoinToEvmSwap).toHaveBeenCalledWith({
        targetAddress: '0xRecipient', tokenAddress: '0xusdt0', evmChainId: 42161, sourceAmount: 200000
      })
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: 'bc1qhtlc', value: 200000n })
      expect(result.transactions).toEqual([
        { hash: 'btcfundtx', chain: 'Bitcoin', type: 'source' },
        { hash: '0xevmclaim', chain: 42161, type: 'destination' }
      ])
    })

    test('EVM -> Bitcoin funds via the account and claims to the BTC address with a fee rate', async () => {
      protocol = new SatoraProtocol(evmAccount(), { feeRateSatPerVb: 7 })

      mockClient.createEvmToBitcoinSwap.mockResolvedValue({
        response: { id: 'swap-6', source_amount: '1000000', target_amount: '1450', fee_sats: 30 }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: 'btcclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', direction: 'evm_to_bitcoin', evm_chain_id: 42161, evm_fund_txid: '0xfundtx', btc_claim_txid: 'btcclaimtx' })

      const result = await protocol.swidge({
        fromToken: '0xusdt0', toToken: 'btc', toChain: 'Bitcoin', fromTokenAmount: 1000000n, recipient: 'bc1qdest'
      })

      expect(mockClient.createEvmToBitcoinSwap).toHaveBeenCalledWith({
        targetAddress: 'bc1qdest', tokenAddress: '0xusdt0', evmChainId: 42161, userAddress: '0xEvmAccount', sourceAmount: 1000000n
      })
      expect(mockClient.fundSwap.mock.calls[0][0]).toBe('swap-6')
      expect(mockClient.claim).toHaveBeenCalledWith('swap-6', { destinationAddress: 'bc1qdest', feeRateSatPerVb: 7 })
      expect(result.transactions).toEqual([
        { hash: '0xfundtx', chain: 42161, type: 'source' },
        { hash: 'btcclaimtx', chain: 'Bitcoin', type: 'destination' }
      ])
    })
  })

  describe('getSwidgeStatus', () => {
    test('maps a settled swap to completed with source/destination transactions', async () => {
      mockClient.getSwap.mockResolvedValue({
        status: 'serverredeemed',
        btc_fund_txid: 'btcfund',
        evm_claim_txid: '0xevmclaim',
        evm_chain_id: 42161
      })

      const status = await protocol.getSwidgeStatus('swap-1')

      expect(mockClient.getSwap).toHaveBeenCalledWith('swap-1')
      expect(status).toEqual({
        status: 'completed',
        transactions: [
          { hash: 'btcfund', chain: 'Arkade', type: 'source' },
          { hash: '0xevmclaim', chain: 42161, type: 'destination' }
        ]
      })
    })

    test('maps in-flight and failure statuses, omitting absent transactions', async () => {
      const cases = [
        ['pending', 'pending'],
        ['clientfunded', 'pending'],
        ['serverfunded', 'action-required'],
        ['clientredeeming', 'pending'],
        ['expired', 'expired'],
        ['clientrefunded', 'refunded'],
        ['serverwontfund', 'failed'],
        ['clientinvalidfunded', 'action-required']
      ]
      for (const [sdk, wdk] of cases) {
        mockClient.getSwap.mockResolvedValue({ status: sdk })
        await expect(protocol.getSwidgeStatus('swap-1')).resolves.toEqual({ status: wdk })
      }
    })

    test('falls back to pending for an unknown status', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'something-new' })
      await expect(protocol.getSwidgeStatus('swap-1')).resolves.toEqual({ status: 'pending' })
    })

    test('propagates the error when no swap exists for the id', async () => {
      mockClient.getSwap.mockRejectedValue(new Error('not found'))
      await expect(protocol.getSwidgeStatus('nope')).rejects.toThrow('not found')
    })
  })

  describe('resumeSwidge', () => {
    beforeEach(() => {
      protocol = new SatoraProtocol({ keyPair: { privateKey: PRIVATE_KEY } })
    })

    test('requires an account (the swap key is derived from it)', async () => {
      await expect(new SatoraProtocol().resumeSwidge('swap-1')).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('returns immediately when the swap is already settled', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'serverredeemed', btc_fund_txid: 'f', evm_claim_txid: 'c', evm_chain_id: 42161 })

      const result = await protocol.resumeSwidge('swap-1')

      expect(result).toEqual({
        id: 'swap-1',
        status: 'completed',
        transactions: [{ hash: 'f', chain: 'Arkade', type: 'source' }, { hash: 'c', chain: 42161, type: 'destination' }]
      })
      expect(mockClient.claim).not.toHaveBeenCalled()
    })

    test('drives an in-flight swap to completion (claim + settle)', async () => {
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'clientfunded' })
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: 'c', evm_chain_id: 1 })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok' })

      const result = await protocol.resumeSwidge('swap-1')

      expect(mockClient.claim).toHaveBeenCalledWith('swap-1', undefined)
      expect(result.status).toBe('completed')
      expect(result.transactions).toEqual([{ hash: 'c', chain: 1, type: 'destination' }])
    })

    test('throws when the swap cannot complete', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'expired' })

      await expect(protocol.resumeSwidge('swap-1')).rejects.toThrow(/expired/)
      expect(mockClient.claim).not.toHaveBeenCalled()
    })
  })

  describe('refundSwidge', () => {
    let account

    beforeEach(() => {
      account = { keyPair: { privateKey: PRIVATE_KEY }, getAddress: jest.fn().mockResolvedValue('ark1qsource') }
      protocol = new SatoraProtocol(account, { chain: 'Arkade' })
    })

    test('throws if no account is bound (needed to receive the refund)', async () => {
      const noAccount = new SatoraProtocol()
      await expect(noAccount.refundSwidge('swap-1')).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
    })

    test('refunds to the account address by default', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: true, message: 'refunded', txId: 'btcrefund' })
      mockClient.getSwap.mockResolvedValue({ status: 'clientrefunded' })

      const result = await protocol.refundSwidge('swap-1')

      expect(mockClient.refundSwap).toHaveBeenCalledWith('swap-1', { destinationAddress: 'ark1qsource' })
      expect(result.status).toBe('refunded')
      expect(result.message).toBe('refunded')
      expect(result.transactions).toContainEqual({ hash: 'btcrefund', type: 'refund' })
    })

    test('merges caller options over the default destination address', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: true, message: 'ok' })
      mockClient.getSwap.mockResolvedValue({ status: 'clientrefunded' })

      await protocol.refundSwidge('swap-1', { destinationAddress: 'ark1qother' })

      expect(mockClient.refundSwap).toHaveBeenCalledWith('swap-1', { destinationAddress: 'ark1qother' })
    })

    test('throws when the refund is not successful', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: false, message: 'too early to refund' })
      mockClient.getSwap.mockResolvedValue({ status: 'serverfunded' })

      await expect(protocol.refundSwidge('swap-1')).rejects.toThrow('too early to refund')
    })

    test('EVM-sourced swap refunds via the collaborative signer path (gasless), signing with the account', async () => {
      protocol = new SatoraProtocol(evmAccount())
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'evm_to_bitcoin', evm_chain_id: 42161 })
      mockClient.collabRefundEvmWithSigner.mockResolvedValue({ txHash: '0xrefundtx' })

      const result = await protocol.refundSwidge('swap-1')

      const [swapId, signer] = mockClient.collabRefundEvmWithSigner.mock.calls[0]
      expect(swapId).toBe('swap-1')
      expect(signer.address).toBe('0xEvmAccount')
      expect(signer.chainId).toBe(42161)
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
      expect(result.status).toBe('refunded')
      expect(result.transactions).toContainEqual({ hash: '0xrefundtx', chain: 42161, type: 'refund' })
    })

    test('EVM-sourced refund honours options.manual (timelock refund)', async () => {
      protocol = new SatoraProtocol(evmAccount())
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'evm_to_arkade', evm_chain_id: 42161 })
      mockClient.refundEvmWithSigner.mockResolvedValue({ txHash: '0xrefundtx' })

      await protocol.refundSwidge('swap-1', { manual: true })

      expect(mockClient.refundEvmWithSigner.mock.calls[0][0]).toBe('swap-1')
      expect(mockClient.collabRefundEvmWithSigner).not.toHaveBeenCalled()
    })

    test('Lightning-sourced swap cannot be refunded', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'lightning_to_evm' })

      await expect(protocol.refundSwidge('swap-1')).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
    })
  })

  describe('getSupportedChains', () => {
    test('maps and de-duplicates the chains from swap pairs', async () => {
      mockClient.getSwapPairs.mockResolvedValue({
        pairs: [
          { source: 'Bitcoin', target: '137' },
          { source: '137', target: 'Bitcoin' }, // duplicates, must be collapsed
          { source: 'Lightning', target: '1' },
          { source: 'Arkade', target: '42161' }
        ]
      })

      const chains = await protocol.getSupportedChains()

      // EVM chains are surfaced with numeric ids; non-EVM chains keep their name.
      expect(chains).toEqual([
        { id: 'Bitcoin', name: 'Bitcoin', type: 'utxo', nativeToken: 'BTC' },
        { id: 137, name: 'Polygon', type: 'evm', nativeToken: 'POL' },
        { id: 'Lightning', name: 'Lightning Network', type: 'lightning', nativeToken: 'BTC' },
        { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
        { id: 'Arkade', name: 'Arkade', type: 'ark', nativeToken: 'BTC' },
        { id: 42161, name: 'Arbitrum', type: 'evm', nativeToken: 'ETH' }
      ])
    })

    test('propagates client errors', async () => {
      mockClient.getSwapPairs.mockRejectedValue(new Error('swap pairs unavailable'))

      await expect(protocol.getSupportedChains()).rejects.toThrow('swap pairs unavailable')
    })
  })

  describe('getSupportedTokens', () => {
    const tokensResponse = {
      btc_tokens: [
        { token_id: 'btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, name: 'Bitcoin' }
      ],
      evm_tokens: [
        { token_id: '0xusdt0', chain: '42161', symbol: 'USDT0', decimals: 6, name: 'USDT0' },
        { token_id: '0xusdt', chain: '1', symbol: 'USDT', decimals: 6, name: 'Tether USD' }
      ]
    }

    beforeEach(() => {
      mockClient.getTokens.mockResolvedValue(tokensResponse)
    })

    test('maps btc and evm tokens to bare provider ids with their chain, setting address for evm only', async () => {
      const tokens = await protocol.getSupportedTokens()

      expect(tokens).toEqual([
        { token: 'btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, name: 'Bitcoin' },
        { token: '0xusdt0', chain: 42161, symbol: 'USDT0', decimals: 6, name: 'USDT0', address: '0xusdt0' },
        { token: '0xusdt', chain: 1, symbol: 'USDT', decimals: 6, name: 'Tether USD', address: '0xusdt' }
      ])
    })

    test('filters tokens by destination chain', async () => {
      const tokens = await protocol.getSupportedTokens({ toChain: 42161 })

      expect(tokens).toEqual([
        { token: '0xusdt0', chain: 42161, symbol: 'USDT0', decimals: 6, name: 'USDT0', address: '0xusdt0' }
      ])
    })

    test('filters tokens by source chain, accepting non-EVM names case-insensitively', async () => {
      const tokens = await protocol.getSupportedTokens({ fromChain: 'bitcoin' })

      expect(tokens.map(token => token.token)).toEqual(['btc'])
    })

    test('ignores fromToken when no chain filter is given', async () => {
      const tokens = await protocol.getSupportedTokens({ fromToken: '0xusdt0' })

      expect(tokens).toHaveLength(3)
    })
  })
})
