# Alternate Clouds Authentication Service

## What is this project?

A standalone multi-method authentication service for the Alternate Clouds platform. Supports passwordless email/SMS, Web3 wallets, and social OAuth providers with JWT-based sessions and account linking.

## Tech Stack

- **Runtime**: Alternate Clouds Functions
- **Framework**: Hono (edge-compatible)
- **Database**: SQLite (Turso compatible)
- **Language**: TypeScript 5.4
- **JWT**: jsonwebtoken
- **Crypto**: @noble/hashes, @noble/secp256k1
- **Validation**: Zod
- **Testing**: Vitest

## Authentication Methods Supported

1. **Email Magic Links** - Passwordless email authentication
2. **SMS OTP** - Passwordless phone authentication
3. **Web3 Wallets** - Sign-In with Ethereum (SIWE), MetaMask, WalletConnect, Phantom
4. **Social OAuth** - Google, Apple, Twitter, Discord, GitHub, LinkedIn, Spotify, Instagram, Telegram, TikTok, Farcaster

## Features

- JWT-based sessions with refresh tokens
- Multi-factor authentication (MFA/2FA)
- Account linking (multiple auth methods per user)
- Rate limiting and security measures
- GDPR-compliant user data management

## Project Structure

```
alternatefutures-auth/
├── src/
│   ├── routes/
│   │   ├── auth/              # Authentication endpoints
│   │   │   ├── email.ts       # Email magic link
│   │   │   ├── sms.ts         # SMS OTP
│   │   │   ├── wallet.ts      # Web3 wallet (SIWE)
│   │   │   ├── oauth.ts       # Social OAuth
│   │   │   └── session.ts     # JWT sessions
│   │   └── account/           # Account management
│   │       ├── profile.ts     # User profile
│   │       └── methods.ts     # Auth methods management
│   ├── services/
│   │   ├── jwt.service.ts     # JWT generation/validation
│   │   ├── email.service.ts   # Email sending (Resend)
│   │   ├── sms.service.ts     # SMS sending (Twilio)
│   │   ├── db.service.ts      # Database operations
│   │   └── crypto.service.ts  # Encryption/hashing
│   ├── middleware/
│   │   ├── auth.ts            # JWT verification
│   │   ├── ratelimit.ts       # Rate limiting
│   │   └── cors.ts            # CORS configuration
│   ├── models/
│   │   ├── user.ts            # User model
│   │   ├── session.ts         # Session model
│   │   └── auth-method.ts     # Auth method model
│   ├── utils/
│   │   ├── otp.ts             # OTP generation
│   │   └── validators.ts      # Input validation
│   └── index.ts               # Main entry point
├── db/
│   └── schema.sql             # Database schema
├── tests/
│   └── auth.test.ts           # Tests
├── .claude/                   # Claude Code configuration
├── .env.example               # Environment variables template
├── tsconfig.json
└── package.json
```

## Database Schema

### Tables:
- **users** - User accounts
- **auth_methods** - Linked authentication methods per user
- **sessions** - Active JWT refresh tokens
- **verification_codes** - Email/SMS verification codes
- **siwe_challenges** - Sign-In with Ethereum challenges
- **mfa_settings** - Multi-factor authentication settings
- **rate_limits** - Rate limiting tracking

See `db/schema.sql` for complete schema.

## API Endpoints

### Authentication
- `POST /auth/email/request` - Request email magic link
- `POST /auth/email/verify` - Verify email code
- `POST /auth/sms/request` - Request SMS OTP
- `POST /auth/sms/verify` - Verify SMS OTP
- `POST /auth/wallet/challenge` - Get SIWE challenge
- `POST /auth/wallet/verify` - Verify wallet signature
- `GET /auth/oauth/:provider` - Initiate OAuth flow
- `GET /auth/oauth/callback` - OAuth callback
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout (invalidate tokens)

### Account Management
- `GET /account/profile` - Get user profile
- `PATCH /account/profile` - Update profile
- `GET /account/methods` - List linked auth methods
- `POST /account/methods/link` - Link new auth method
- `DELETE /account/methods/:id` - Unlink auth method

## Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in your API keys

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

Required:
- `DATABASE_URL` - Database connection string
- `JWT_SECRET` - Secret for signing JWTs
- `JWT_REFRESH_SECRET` - Secret for refresh tokens
- `RESEND_API_KEY` - Email service (Resend)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` - SMS service (Twilio)

Optional (OAuth providers):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`
- etc.

See `.env.example` for full list.

## Deployment

This service is designed to be deployed as an **Alternate Clouds Function**. Once the AF Functions platform is ready, this authentication service will be one of the first production deployments on the platform.

### Deployment Target
- **Primary**: Alternate Clouds Functions platform
- **Development**: Node.js for local testing

## Security Considerations

- All passwords are hashed with bcrypt (if password auth is added)
- JWT secrets must be strong random strings
- Rate limiting on all endpoints
- CORS configured for your frontend domain
- Input validation with Zod schemas
- SQL injection protection via parameterized queries
- XSS protection via proper output encoding

## Implementation Status

### ✅ Completed (MVP Backend)
- Project structure setup
- Database schema designed and created
- TypeScript configuration
- Hono server with routing
- JWT token service (access + refresh tokens)
- Email magic link authentication
- Web3 wallet authentication (SIWE)
- OAuth social providers (Google, GitHub, etc.)
- Account linking and management
- Rate limiting middleware
- CORS middleware
- Email service integration (Resend)
- Database service layer (SQLite/Turso)
- Authentication middleware
- Input validation (Zod schemas)
- Comprehensive test suite (Vitest)
- API documentation
- Deployment documentation

### 📋 Future Enhancements (Post-MVP)
- SMS OTP authentication
- SMS service integration (Twilio)
- Multi-factor authentication (MFA/2FA)
- WebAuthn/Passkeys support
- Magic link rate limiting improvements
- Session management UI
- Account recovery flows
- Email templates customization

## Related Projects

- **altfutures-app** - Main SvelteKit application that uses this auth service
- **@alternatefutures/login-button** - UI components for authentication

## References

- Architecture: See `altfutures-app/AUTH_SYSTEM_SPEC.md`
- DePIN Auth: See `altfutures-app/DEPIN_AUTH_ARCHITECTURE.md`

---

**Status**: In Development
**Version**: 0.1.0
