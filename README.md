# Alternate Futures Authentication Service

[![Tests](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml/badge.svg)](https://github.com/alternatefutures/service-auth/actions/workflows/test.yml)

Multi-method authentication system supporting email, SMS, Web3 wallets, and social OAuth providers.

## Features

- 🔐 **Passwordless Authentication**
  - Email magic links
  - SMS OTP codes

- 🦊 **Web3 Wallet Support**
  - Sign-In with Ethereum (SIWE)
  - MetaMask, WalletConnect, Phantom
  - Support for Ethereum and Solana

- 🌐 **Social OAuth Providers**
  - Google, Twitter/X, GitHub
  - Discord (more coming soon)
  - ~~Apple~~ (temporarily disabled)

- 🔗 **Account Linking**
  - Link multiple auth methods to one account
  - Unified user identity

- 🛡️ **Security**
  - JWT-based sessions with refresh tokens
  - Multi-factor authentication (MFA)
  - Rate limiting
  - Secure key storage

## Tech Stack

- **Runtime**: Alternate Futures Functions
- **Framework**: Hono (edge-compatible)
- **Database**: Turso (SQLite) or local SQLite
- **Email**: Resend or SendGrid
- **SMS**: httpSMS (Open Source SMS Gateway)
- **Web3**: @noble/secp256k1, viem

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

```bash
# Database
DATABASE_URL=

# JWT Secrets
JWT_SECRET=
JWT_REFRESH_SECRET=

# Email (Resend)
RESEND_API_KEY=

# SMS (httpSMS - Open Source)
HTTPSMS_API_KEY=
HTTPSMS_PHONE_NUMBER=

# OAuth Providers
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Add more as needed
```

### Setting Up httpSMS

httpSMS is an open-source SMS gateway that uses your Android phone to send/receive SMS messages:

1. **Install the Android App**
   - Download from [GitHub Releases](https://github.com/NdoleStudio/httpsms/releases)
   - Install on any Android phone

2. **Get API Key**
   - Visit [httpsms.com/settings](https://httpsms.com/settings)
   - Sign up and generate an API key
   - Add your phone number in the dashboard

3. **Configure Environment**
   ```bash
   HTTPSMS_API_KEY=your_api_key_here
   HTTPSMS_PHONE_NUMBER=+1234567890  # Your Android phone number
   ```

4. **Self-Hosting (Optional)**
   - httpSMS can be self-hosted for full control
   - See [httpSMS Documentation](https://docs.httpsms.com) for self-hosting guide

**Why httpSMS?**
- ✅ Open source (MIT license)
- ✅ End-to-end encryption (AES-256)
- ✅ Self-hostable or cloud-hosted
- ✅ No monthly fees (just use your existing phone plan)
- ✅ Full control over your SMS infrastructure

## API Endpoints

### Authentication

```
POST   /auth/email/request      # Request email magic link
POST   /auth/email/verify       # Verify email code
POST   /auth/sms/request        # Request SMS OTP
POST   /auth/sms/verify         # Verify SMS OTP
POST   /auth/wallet/challenge   # Get SIWE challenge
POST   /auth/wallet/verify      # Verify wallet signature
GET    /auth/oauth/:provider    # Initiate OAuth flow
GET    /auth/oauth/callback     # OAuth callback
POST   /auth/refresh            # Refresh access token
POST   /auth/logout             # Logout (invalidate tokens)
```

### Account Management

```
GET    /account/profile         # Get user profile
PATCH  /account/profile         # Update profile
GET    /account/methods         # List linked auth methods
POST   /account/methods/link    # Link new auth method
DELETE /account/methods/:id     # Unlink auth method
```

## Project Structure

```
alternatefutures-auth/
├── src/
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── email.ts        # Email magic link
│   │   │   ├── sms.ts          # SMS OTP
│   │   │   ├── wallet.ts       # Web3 wallet (SIWE)
│   │   │   ├── oauth.ts        # Social OAuth
│   │   │   └── session.ts      # JWT sessions
│   │   └── account/
│   │       ├── profile.ts      # User profile
│   │       └── methods.ts      # Auth methods management
│   ├── services/
│   │   ├── jwt.service.ts      # JWT generation/validation
│   │   ├── email.service.ts    # Email sending (Resend)
│   │   ├── sms.service.ts      # SMS sending (httpSMS)
│   │   ├── db.service.ts       # Database operations
│   │   └── crypto.service.ts   # Encryption/hashing
│   ├── middleware/
│   │   ├── auth.ts             # JWT verification middleware
│   │   ├── ratelimit.ts        # Rate limiting
│   │   └── cors.ts             # CORS configuration
│   ├── models/
│   │   ├── user.ts             # User model
│   │   ├── session.ts          # Session model
│   │   └── auth-method.ts      # Auth method model
│   ├── utils/
│   │   ├── otp.ts              # OTP generation
│   │   └── validators.ts       # Input validation (Zod)
│   └── index.ts                # Main entry point
├── db/
│   └── schema.sql              # Database schema
├── tests/
│   └── auth.test.ts            # Authentication tests
├── .env.example                # Environment variables template
├── tsconfig.json               # TypeScript configuration
└── package.json
```

## Deployment

This service is designed to be deployed as an **Alternate Futures Function**. Once the AF Functions platform is ready, you can deploy this authentication service directly through the platform.

### Deployment Steps (Coming Soon)

1. Build the project: `npm run build`
2. Deploy via AF Functions Dashboard
3. Configure environment variables in AF Platform
4. Set up custom domain (optional)

The service will automatically scale and run on the AF Functions infrastructure.

## Development

This is a work in progress. See the implementation roadmap in the project documentation.

## License

MIT

---

**Status**: In Development
**Version**: 0.1.0
