-- Crypto-topup hardening (audit C2/C3/H2/M5):
-- The Relay payment.completed webhook is authenticated by HMAC only.
-- If the HMAC secret leaks an attacker can forge events. Mitigation is
-- to make the on-chain re-check use ONLY values we recorded at intent
-- creation time, never values echoed back by the webhook.
--
-- Adds:
--   * token_symbol     – server-chosen stablecoin symbol (USDC/USDT/DAI/...)
--   * token_address    – canonical ERC-20 contract address for that
--                        (chainId, symbol). Looked up from the static
--                        allowlist; rejects anything else on-chain.
--   * org_billing_id   – which org's wallet is being topped up. Lets the
--                        webhook handler ignore metadata.orgBillingId
--                        coming back from the provider.

ALTER TABLE "auth_payments"
  ADD COLUMN "token_symbol"    TEXT,
  ADD COLUMN "token_address"   TEXT,
  ADD COLUMN "org_billing_id"  TEXT;

CREATE INDEX "auth_payments_org_billing_id_idx"
  ON "auth_payments"("org_billing_id");
