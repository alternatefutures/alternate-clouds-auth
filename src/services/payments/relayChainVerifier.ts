/**
 * Relay.link webhook → on-chain verification.
 *
 * The Relay webhook is authenticated only by an HMAC of a *shared
 * secret*. If that secret ever leaks (CI exfil, contractor laptop,
 * logging accident, Relay-side breach), an attacker can mint
 * arbitrary `payment.completed` events and credit themselves with
 * payments that never landed on-chain.
 *
 * This module re-checks the chain *independently* before we trust
 * any settlement event:
 *
 *   1. The transaction exists on the claimed chain and is included
 *      (status = success, has at least N confirmations).
 *   2. The recipient is the deposit address we (or Relay) generated
 *      for that payment.
 *   3. For ERC-20 transfers (USDC/USDT/DAI) the on-chain `Transfer`
 *      log to that address transferred at least the expected
 *      stablecoin amount, with the right token decimals.
 *
 * We deliberately do NOT enforce a strict value match for native
 * ETH / non-stable tokens — without an oracle we can't know what FX
 * rate Relay used at quote time. We do still require that the
 * recipient and tx existence check out, which is enough to defeat a
 * forged-webhook attack (the only thing the audit flagged).
 *
 * Behaviour is gated by `RELAY_REQUIRE_CHAIN_VERIFY`:
 *
 *   * `true`  (default in production) — settlement is rejected if
 *             chain verification fails for any reason, including a
 *             missing RPC URL.
 *   * `false`  — verification is attempted best-effort and a failure
 *             only logs a warning. Used when bootstrapping new chain
 *             support or temporarily working around an RPC outage.
 *             Set as a kill-switch ONLY for emergency.
 */

import { JsonRpcProvider, getAddress, Interface } from 'ethers';

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/**
 * Default minimum confirmations per chain. Tuned to match the
 * confirmation depth at which a re-org is statistically improbable
 * for ~$10k payments (the largest invoice we currently support).
 *
 * Override per-chain via `EVM_MIN_CONFIRMATIONS_<CHAINID>`.
 */
const DEFAULT_MIN_CONFIRMATIONS: Record<number, number> = {
  1: 12,        // Ethereum mainnet
  10: 50,       // Optimism
  56: 15,       // BSC
  137: 64,      // Polygon
  324: 12,      // zkSync
  8453: 50,     // Base
  42161: 50,    // Arbitrum
  43114: 12,    // Avalanche
  59144: 50,    // Linea
  534352: 50,   // Scroll
  7777777: 50,  // Zora
};

const FALLBACK_MIN_CONFIRMATIONS = 12;

/**
 * Stablecoin decimals — used to validate amount when the payment
 * token is a USD-pegged stablecoin. Anything not in here is treated
 * as "value match not enforced".
 */
const STABLECOIN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  USDP: 18,
  GUSD: 2,
  BUSD: 18,
};

export interface RelayVerifyInput {
  txHash: string;
  chainId: number;
  /** Address we expect the funds to have arrived at (the deposit address we recorded). */
  expectedToAddress: string;
  /**
   * Expected amount in cents (we always quote in USD-cents internally).
   * Used to enforce a min-amount check for stablecoin transfers.
   */
  expectedAmountCents: number;
  /**
   * Stablecoin symbol we recorded when creating the intent. Optional
   * for legacy native-token flows. The verifier will only attempt a
   * strict amount check when both `tokenSymbol` is a recognised
   * stablecoin and `tokenAddress` is present.
   */
  tokenSymbol?: string;
  /**
   * Canonical ERC-20 contract for the (chainId, tokenSymbol) pair, as
   * resolved from our static allowlist at intent creation time and
   * persisted on the payment row. The on-chain Transfer log MUST be
   * emitted by this exact contract — anything else is rejected as a
   * fake-ERC-20 spoof. Pass `undefined` to fall back to native-asset
   * verification.
   */
  tokenAddress?: string;
}

export type RelayVerifyResult =
  | { ok: true }
  | { ok: false; reason: string; details?: Record<string, unknown> };

/**
 * Whether chain verification is mandatory. Default true. The kill
 * switch (`RELAY_REQUIRE_CHAIN_VERIFY=false`) is intentionally
 * loud — log it on first read so audits can see when it's off.
 */
let killSwitchLogged = false;
export function isChainVerifyRequired(): boolean {
  const raw = process.env.RELAY_REQUIRE_CHAIN_VERIFY;
  const required = raw == null ? true : raw.toLowerCase() !== 'false';
  if (!required && !killSwitchLogged) {
    console.warn(
      '[relayChainVerifier] RELAY_REQUIRE_CHAIN_VERIFY=false — webhook claims will be trusted without independent on-chain proof. ONLY for emergency / bootstrap.',
    );
    killSwitchLogged = true;
  }
  return required;
}

function getRpcUrl(chainId: number): string | undefined {
  const direct = process.env[`EVM_RPC_${chainId}`];
  if (direct) return direct;
  const jsonBlob = process.env.EVM_RPC_URLS_JSON;
  if (jsonBlob) {
    try {
      const parsed = JSON.parse(jsonBlob) as Record<string, string>;
      return parsed[String(chainId)];
    } catch {
      // fall through
    }
  }
  return undefined;
}

function getMinConfirmations(chainId: number): number {
  const env = process.env[`EVM_MIN_CONFIRMATIONS_${chainId}`];
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return DEFAULT_MIN_CONFIRMATIONS[chainId] ?? FALLBACK_MIN_CONFIRMATIONS;
}

function safeChecksum(addr: string): string | null {
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/**
 * Independent on-chain verification of a Relay-claimed payment.
 *
 * Returns a structured result so callers can log a precise reason
 * for rejection. Throws only on programmer error — every legitimate
 * "this payment is not real" outcome is a returned `ok: false`.
 */
export async function verifyRelayPaymentOnChain(
  input: RelayVerifyInput,
): Promise<RelayVerifyResult> {
  const { txHash, chainId, expectedToAddress, expectedAmountCents, tokenSymbol, tokenAddress } =
    input;

  const expectedTo = safeChecksum(expectedToAddress);
  if (!expectedTo) {
    return { ok: false, reason: 'invalid_expected_address', details: { expectedToAddress } };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: 'invalid_tx_hash', details: { txHash } };
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return {
      ok: false,
      reason: 'no_rpc_configured',
      details: { chainId, hint: `Set EVM_RPC_${chainId} or EVM_RPC_URLS_JSON` },
    };
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId, {
    staticNetwork: true,
  });

  let tx: Awaited<ReturnType<JsonRpcProvider['getTransaction']>>;
  let receipt: Awaited<ReturnType<JsonRpcProvider['getTransactionReceipt']>>;
  let head: number;
  try {
    [tx, receipt, head] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);
  } catch (err) {
    return {
      ok: false,
      reason: 'rpc_error',
      details: { chainId, error: (err as Error).message },
    };
  }

  if (!tx || !receipt) {
    return { ok: false, reason: 'tx_not_found', details: { txHash, chainId } };
  }
  if (receipt.status !== 1) {
    return { ok: false, reason: 'tx_failed', details: { txHash, chainId } };
  }

  const txBlock = receipt.blockNumber ?? tx.blockNumber ?? 0;
  const confirmations = txBlock > 0 ? Math.max(0, head - txBlock + 1) : 0;
  const minConfs = getMinConfirmations(chainId);
  if (confirmations < minConfs) {
    return {
      ok: false,
      reason: 'insufficient_confirmations',
      details: { txHash, chainId, confirmations, required: minConfs },
    };
  }

  // Recipient + amount checks branch on whether this is a native
  // transfer or an ERC-20 transfer.
  const isErc20 = Boolean(tokenAddress);

  if (!isErc20) {
    // Native asset (ETH on L1, MATIC on Polygon, etc.).
    const txTo = tx.to ? safeChecksum(tx.to) : null;
    if (!txTo || txTo !== expectedTo) {
      return {
        ok: false,
        reason: 'recipient_mismatch_native',
        details: { txTo, expectedTo },
      };
    }
    // Amount check intentionally skipped for native transfers — see
    // module docstring.
    return { ok: true };
  }

  // ERC-20 path: tx.to should be the token contract; the actual
  // recipient is in the Transfer log emitted by that contract.
  const tokenAddrChecksummed = safeChecksum(tokenAddress!);
  if (!tokenAddrChecksummed) {
    return { ok: false, reason: 'invalid_token_address', details: { tokenAddress } };
  }
  const txTo = tx.to ? safeChecksum(tx.to) : null;
  if (txTo !== tokenAddrChecksummed) {
    return {
      ok: false,
      reason: 'token_contract_mismatch',
      details: { txTo, tokenAddress: tokenAddrChecksummed },
    };
  }

  // Find a Transfer(_, expectedTo, value) log emitted by the token contract.
  const transferLog = receipt.logs.find((log) => {
    if (!log.topics || log.topics.length < 3) return false;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) return false;
    const logAddr = safeChecksum(log.address);
    if (logAddr !== tokenAddrChecksummed) return false;
    // topics[2] is `to`, padded to 32 bytes.
    const toFromTopic = `0x${log.topics[2].slice(-40)}`;
    return safeChecksum(toFromTopic) === expectedTo;
  });
  if (!transferLog) {
    return { ok: false, reason: 'no_transfer_log_to_recipient', details: { txHash } };
  }

  // Stablecoin amount check.
  const symKey = (tokenSymbol ?? '').toUpperCase();
  const decimals = STABLECOIN_DECIMALS[symKey];
  if (decimals != null) {
    let parsedValue: bigint;
    try {
      const parsed = ERC20_INTERFACE.parseLog({
        topics: [...transferLog.topics],
        data: transferLog.data,
      });
      if (!parsed) {
        return { ok: false, reason: 'malformed_transfer_log', details: { txHash } };
      }
      parsedValue = parsed.args[2] as bigint;
    } catch (err) {
      return {
        ok: false,
        reason: 'malformed_transfer_log',
        details: { txHash, error: (err as Error).message },
      };
    }

    // Convert expected cents to token base units. Stablecoins assumed
    // to be 1:1 with USD, so $X.XX = X * 10^decimals / 100 base units.
    const expectedBase =
      (BigInt(expectedAmountCents) * 10n ** BigInt(decimals)) / 100n;
    if (parsedValue < expectedBase) {
      return {
        ok: false,
        reason: 'insufficient_stablecoin_amount',
        details: {
          txHash,
          tokenSymbol: symKey,
          received: parsedValue.toString(),
          expected: expectedBase.toString(),
        },
      };
    }
  }

  return { ok: true };
}
