<div align="center">

# ☁️ service-auth

**Authentication · Billing · AI Inference Proxy**

Part of the [Alternate Clouds](https://alternatefutures.ai) platform.

[![Tests](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml/badge.svg)](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml)

---

</div>

## Overview

Hono-based API service handling authentication, organization management, billing (Stripe), and an AI inference proxy with real-time cost metering across 11 providers.

Runs on port **1601**.

---

## Quick Start

```bash
pnpm install
cp .env.example .env
npx prisma migrate dev
pnpm dev
```

---

## Features

### Authentication
- **Passwordless** — Email OTP (Resend), SMS OTP (Twilio)
- **Web3** — Sign-In with Ethereum (SIWE), MetaMask, WalletConnect, Phantom
- **OAuth** — Google, GitHub, Discord, X/Twitter
- **Account linking** — multiple auth methods per user
- **Personal Access Tokens** — encrypted PATs for CLI and API access
- **JWT sessions** — access + refresh tokens, timing-safe OTP comparison

### Organizations & Billing
- Org CRUD, membership, roles
- Stripe subscriptions (seat-based) + credits wallet with idempotent ledger
- Payment methods, invoices, usage tracking
- Stripe Connect transfers

### AI Inference Proxy
Single endpoint, 11 providers, per-token billing deducted from credits wallet:

`OpenAI · Anthropic · Groq · Together · DeepSeek · OpenRouter · xAI · Stability · ElevenLabs · Fal AI · World Labs`

---

## API Routes

| Group | Prefix | Purpose |
|-------|--------|---------|
| Auth | `/auth/email`, `/auth/sms`, `/auth/wallet`, `/auth/oauth` | Login flows |
| Session | `/auth/refresh`, `/auth/logout`, `/auth/cli/*` | Token management |
| Account | `/account/profile`, `/account/methods` | Profile + linked methods |
| Tokens | `/tokens` | PAT CRUD + validation |
| Orgs | `/organizations` | Org CRUD + membership |
| Billing | `/billing/subscriptions`, `/billing/credits/*`, `/billing/webhook` | Stripe integration |
| AI | `/ai/openai/*`, `/ai/anthropic/*`, ... | Inference proxy |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js |
| Framework | Hono |
| Database | PostgreSQL + Prisma |
| Email | Resend |
| SMS | Twilio |
| Payments | Stripe |
| Web3 | ethers.js, @noble/secp256k1 |
| Secrets | Infisical (production) |

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing secret |
| `RESEND_API_KEY` | Yes | Email delivery |
| `STRIPE_SECRET_KEY` | For billing | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing |
| `AUTH_INTROSPECTION_SECRET` | Yes | Shared secret with service-cloud-api |

---

## Related

- [service-cloud-api](https://github.com/alternatefutures/service-cloud-api) — GraphQL API
- [web-app](https://github.com/alternatefutures/web-app.alternatefutures.ai) — Dashboard
- [package-cloud-cli](https://github.com/alternatefutures/package-cloud-cli) — CLI

---

MIT License
