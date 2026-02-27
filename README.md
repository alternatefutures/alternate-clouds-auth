# Alternate Futures Authentication Service

[![Tests](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml/badge.svg)](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml)

Multi-method authentication system supporting email, SMS, Web3 wallets, and social OAuth providers.

## Features

- **Passwordless Authentication**
  - Email OTP codes
  - SMS OTP codes (Twilio)

- **Web3 Wallet Support**
  - Sign-In with Ethereum (SIWE)
  - MetaMask, WalletConnect, Phantom
  - Support for Ethereum and Solana

- **Social OAuth Providers**
  - Google, Twitter/X, GitHub
  - Discord (more coming soon)
  - ~~Apple~~ (temporarily disabled)

- **Account Linking**
  - Link multiple auth methods to one account
  - Unified user identity

- **Organization Management**
  - Org CRUD, membership, roles
  - Org-scoped billing and subscriptions

- **Billing & Usage Wallet**
  - Stripe PaymentIntents, subscriptions, seat-based pricing
  - Org-scoped USD credits wallet with idempotent ledger
  - AI inference proxy with real-time cost metering (11 providers)

- **Personal Access Tokens**
  - Encrypted PAT creation/validation
  - CLI login session management

- **Security**
  - JWT-based sessions with refresh tokens
  - Timing-safe OTP comparison
  - Production-enforced JWT secrets (no weak fallbacks)
  - Rate limiting (in-memory; Redis recommended for production)
  - Sanitized error responses in production

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Hono
- **Database**: PostgreSQL via Prisma ORM
- **Email**: Resend
- **SMS**: Twilio
- **Web3**: ethers.js, @noble/secp256k1
- **Payments**: Stripe, Stax, Relay
- **Secrets**: Infisical SDK (production)

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Push database schema
npx prisma db push

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The server defaults to port **1601** (configurable via `PORT` env var).

## API Endpoints

### Authentication

```
POST   /auth/email/request      # Request email OTP
POST   /auth/email/verify       # Verify email OTP
POST   /auth/sms/request        # Request SMS OTP
POST   /auth/sms/verify         # Verify SMS OTP
POST   /auth/wallet/challenge   # Get SIWE challenge
POST   /auth/wallet/verify      # Verify wallet signature
GET    /auth/oauth/:provider    # Initiate OAuth flow
GET    /auth/oauth/callback     # OAuth callback
POST   /auth/refresh            # Refresh access token
POST   /auth/logout             # Logout (invalidate tokens)
POST   /auth/cli/start          # Start CLI login session
POST   /auth/cli/poll           # Poll CLI session status
POST   /auth/cli/approve        # Approve CLI login from web
```

### Account Management

```
GET    /account/profile         # Get user profile
PATCH  /account/profile         # Update profile
GET    /account/methods         # List linked auth methods
POST   /account/methods/link    # Link new auth method
DELETE /account/methods/:id     # Unlink auth method
```

### Personal Access Tokens

```
GET    /tokens                  # List PATs
POST   /tokens                  # Create PAT
DELETE /tokens/:id              # Revoke PAT
POST   /tokens/validate         # Validate PAT (service-to-service)
```

### Organizations

```
GET    /organizations           # List user's orgs
POST   /organizations           # Create org
GET    /organizations/:id       # Get org details
PATCH  /organizations/:id       # Update org
DELETE /organizations/:id       # Delete org
```

### Billing

```
GET    /billing/customer        # Get billing customer
POST   /billing/subscriptions   # Create subscription
GET    /billing/subscriptions   # List subscriptions
GET    /billing/invoices        # List invoices
GET    /billing/usage           # Get usage summary
POST   /billing/payment-methods # Add payment method
POST   /billing/credits/topup   # Top up credits wallet
GET    /billing/credits/balance # Get credits balance
GET    /billing/credits/ledger  # Get usage ledger
POST   /billing/webhook         # Stripe webhook
```

### AI Inference Proxy

```
POST   /ai/openai/*             # OpenAI proxy
POST   /ai/anthropic/*          # Anthropic proxy
POST   /ai/groq/*               # Groq proxy
POST   /ai/together/*           # Together AI proxy
POST   /ai/deepseek/*           # DeepSeek proxy
POST   /ai/openrouter/*         # OpenRouter proxy
POST   /ai/xai/*                # xAI proxy
POST   /ai/stability/*          # Stability AI proxy
POST   /ai/elevenlabs/*         # ElevenLabs proxy
POST   /ai/fal-ai/*             # Fal AI proxy
POST   /ai/worldlabs/*          # World Labs proxy
```

## Project Structure

```
service-auth/
├── src/
│   ├── routes/
│   │   ├── auth/           # Authentication (email, sms, wallet, oauth, cli, session)
│   │   ├── account/        # Profile + auth methods
│   │   ├── tokens/         # PAT management
│   │   ├── organizations/  # Org CRUD + membership
│   │   ├── billing/        # Subscriptions, credits, payments, webhooks
│   │   └── ai/             # AI inference proxy (11 providers + cost metering)
│   ├── services/
│   │   ├── db.service.ts       # Database operations (Prisma)
│   │   ├── jwt.service.ts      # JWT generation/validation
│   │   ├── token.service.ts    # PAT encryption/validation
│   │   ├── email.service.ts    # Email sending (Resend)
│   │   ├── sms.service.ts      # SMS sending (Twilio)
│   │   ├── oauth.service.ts    # OAuth provider flows
│   │   ├── siwe.service.ts     # Sign-In with Ethereum
│   │   ├── secrets.service.ts  # Infisical integration
│   │   ├── rateLimiter.service.ts
│   │   └── payments/           # Stripe, Stax, Relay providers
│   ├── middleware/
│   │   ├── auth.ts             # JWT verification middleware
│   │   ├── ratelimit.ts        # Rate limiting
│   │   └── cors.ts             # CORS configuration
│   ├── utils/
│   │   ├── crypto.ts           # Encryption/hashing, timing-safe compare
│   │   ├── otp.ts              # OTP generation
│   │   ├── logger.ts           # Structured logging
│   │   └── validators.ts       # Input validation (Zod)
│   └── index.ts                # Main entry point (Hono app)
├── prisma/
│   └── schema.prisma           # Database schema (PostgreSQL)
├── .env.example                # Environment variables template
├── tsconfig.json
└── package.json
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes (production) | Access token signing secret — **process crashes if unset in production** |
| `JWT_REFRESH_SECRET` | Yes (production) | Refresh token signing secret — **process crashes if unset in production** |
| `RESEND_API_KEY` | Yes | Email delivery via Resend |
| `TWILIO_ACCOUNT_SID` | For SMS | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For SMS | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | For SMS | Twilio sender number |
| `STRIPE_SECRET_KEY` | For billing | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | For billing | Stripe webhook signing secret |
| `TOKEN_ENCRYPTION_KEY` | Recommended | PAT encryption key (falls back to JWT_SECRET) |
| `REDIS_URL` | Recommended | Redis for rate limiting (in-memory fallback warns in production) |
| `INFISICAL_CLIENT_ID` | Production | Infisical secrets management |

## License

MIT
