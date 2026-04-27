/**
 * Canonical stablecoin allowlist.
 *
 * The Relay webhook is authenticated only by HMAC. If that secret ever
 * leaks an attacker can mint `payment.completed` events. Even with the
 * on-chain re-check, an unrestricted ERC-20 path is dangerous: the
 * attacker can deploy a fake "USDC" contract, mint themselves a
 * trillion units of it, transfer to our deposit address, and pass the
 * Transfer-log check.
 *
 * The fix is to never trust the `tokenAddress` field of the webhook.
 * At intent creation time we look up the canonical contract address
 * for the user's chosen `(chainId, tokenSymbol)` in this static
 * allowlist and store it on the payment row. Settlement then enforces
 * that the on-chain Transfer log was emitted by that exact contract.
 *
 * Addresses are checksummed mainnet contracts. Sources:
 *   - Circle docs (USDC)
 *   - Tether docs (USDT)
 *   - MakerDAO docs (DAI)
 *   - Etherscan / chain explorers
 *
 * Adding a new chain or stablecoin REQUIRES code review. Do NOT make
 * this list configurable from the environment.
 */

export type StablecoinSymbol = 'USDC' | 'USDT' | 'DAI';

interface ChainStablecoins {
  /** Native asset symbol; informational only. */
  native: string;
  /** Canonical ERC-20 contracts for supported stablecoins. */
  tokens: Partial<Record<StablecoinSymbol, string>>;
}

/**
 * chainId → { tokenSymbol → canonical contract address (lowercase) }.
 * We store lowercase here and checksum at point-of-use.
 */
const CANONICAL_STABLECOINS: Record<number, ChainStablecoins> = {
  // Ethereum mainnet
  1: {
    native: 'ETH',
    tokens: {
      USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      DAI: '0x6b175474e89094c44da98b954eedeac495271d0f',
    },
  },
  // Optimism
  10: {
    native: 'ETH',
    tokens: {
      USDC: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
      USDT: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
      DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    },
  },
  // BNB Smart Chain
  56: {
    native: 'BNB',
    tokens: {
      USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      USDT: '0x55d398326f99059ff775485246999027b3197955',
      DAI: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
    },
  },
  // Polygon PoS
  137: {
    native: 'MATIC',
    tokens: {
      USDC: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', // native USDC
      USDT: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      DAI: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
    },
  },
  // Base
  8453: {
    native: 'ETH',
    tokens: {
      USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      DAI: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb',
    },
  },
  // Arbitrum One
  42161: {
    native: 'ETH',
    tokens: {
      USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // native USDC
      USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      DAI: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
    },
  },
  // Avalanche C-Chain
  43114: {
    native: 'AVAX',
    tokens: {
      USDC: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
      USDT: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
      DAI: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70',
    },
  },
  // Linea
  59144: {
    native: 'ETH',
    tokens: {
      USDC: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff',
    },
  },
  // Scroll
  534352: {
    native: 'ETH',
    tokens: {
      USDC: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4',
      USDT: '0xf55bec9cafdbe8730f096aa55dad6d22d44099df',
    },
  },
};

const SUPPORTED_SYMBOLS: ReadonlyArray<StablecoinSymbol> = ['USDC', 'USDT', 'DAI'];

/**
 * Returns the canonical lowercase contract address for the given
 * `(chainId, symbol)`, or `null` if the pair isn't supported.
 *
 * Lowercase is intentional — callers can checksum at point-of-use; the
 * comparison logic in `relayChainVerifier` lowercases everything.
 */
export function getCanonicalStablecoinAddress(
  chainId: number,
  symbol: string,
): string | null {
  const upper = symbol.trim().toUpperCase();
  if (!isSupportedStablecoin(upper)) return null;
  return CANONICAL_STABLECOINS[chainId]?.tokens?.[upper] ?? null;
}

export function isSupportedStablecoin(symbol: string): symbol is StablecoinSymbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(symbol.toUpperCase());
}

export function isSupportedChainId(chainId: number): boolean {
  return Boolean(CANONICAL_STABLECOINS[chainId]);
}

export function listSupportedStablecoinsForChain(chainId: number): StablecoinSymbol[] {
  const entry = CANONICAL_STABLECOINS[chainId];
  if (!entry) return [];
  return Object.keys(entry.tokens) as StablecoinSymbol[];
}
