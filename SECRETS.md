# Environment Variables & Secrets

This document lists all environment variables required for `service-auth`.

All secrets are injected directly as SDL environment variables by `akash-mcp/scripts/redeploy-all.ts` at deploy time. No external secrets manager (Infisical, etc.) is used.

## Required Variables

### JWT Authentication

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret (shared with service-cloud-api) | `your-256-bit-secret` |
| `JWT_REFRESH_SECRET` | Refresh token signing secret | `another-256-bit-secret` |

### Email (Resend)

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key for sending emails | `re_...` |
| `EMAIL_FROM` | From address for emails | `noreply@alternatefutures.ai` |

## OAuth Providers

### Google

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | `GOCSPX-...` |

### GitHub

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | `Iv1.xxx` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | `xxx` |

### Discord (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_CLIENT_ID` | Discord OAuth client ID | `123456789` |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret | `xxx` |

### Twitter/X (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `TWITTER_CLIENT_ID` | Twitter OAuth 2.0 client ID | `xxx` |
| `TWITTER_CLIENT_SECRET` | Twitter OAuth 2.0 client secret | `xxx` |

## SMS Authentication (Optional)

### HTTPSMS

| Variable | Description | Example |
|----------|-------------|---------|
| `HTTPSMS_API_KEY` | httpSMS API key | `xxx` |
| `HTTPSMS_SENDER` | Sender phone number | `+1234567890` |

## Application

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3000` |
| `CORS_ORIGINS` | Allowed CORS origins | `https://app.alternatefutures.ai` |
| `API_URL` | Backend API URL | `https://api.alternatefutures.ai` |

## Database (PostgreSQL)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (auth-dedicated database) | `postgresql://auth:PASSWORD@host:31568/auth` |

**Note:** service-auth has its own dedicated PostgreSQL database, separate from service-cloud-api.
This supports clean isolation for multi-tenant deployments and independent backup/restore.

### Akash Deployment

PostgreSQL is deployed as a shared server on Akash via `redeploy-all.ts`. Auth uses a **dedicated database** (`alternatefutures_auth`) on this server, separate from cloud-api.

For current DSEQ, provider, host, and port, see:
- **`DEPLOYMENTS.md`** (repo root) — updated automatically by each `redeploy-all.ts` run
- **`.env.deploy`** (in `akash-mcp/`) — contains `AUTH_DATABASE_URL` and `API_DATABASE_URL`

### AKASH_CERT_JSON

The `redeploy-all.ts` script injects `AKASH_CERT_JSON` (base64-encoded certificate JSON) into the cloud-api deployment. This allows the embedded akash-mcp subprocess to operate without regenerating certificates.

To set this up manually:
1. Export your Akash certificate: `{ "cert": "...", "publicKey": "...", "privateKey": "..." }`
2. Base64-encode it: `echo '<json>' | base64`
3. Set as `AKASH_CERT_JSON` environment variable

## Example .env

```env
# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_REFRESH_SECRET=another-super-secret-key-min-32-chars

# Email (Resend)
RESEND_API_KEY=re_fz3LETaZ_xxxxxxxxxxxxx
EMAIL_FROM=noreply@alternatefutures.ai

# OAuth - Google
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

# OAuth - GitHub
GITHUB_CLIENT_ID=Iv1.xxx
GITHUB_CLIENT_SECRET=xxx

# Application
NODE_ENV=development
PORT=3000
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
API_URL=http://localhost:4000
```

## Priority Order for Setup

1. **Critical** (service won't start without):
   - `JWT_SECRET`
   - `JWT_REFRESH_SECRET`

2. **Important** (core auth features):
   - `RESEND_API_KEY` (magic links)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

3. **Optional** (additional auth methods):
   - Discord OAuth
   - Twitter OAuth
   - SMS authentication (HTTPSMS)

## OAuth Callback URLs

When configuring OAuth providers, use these callback URLs:

| Provider | Callback URL |
|----------|-------------|
| Google | `https://auth.alternatefutures.ai/auth/google/callback` |
| GitHub | `https://auth.alternatefutures.ai/auth/github/callback` |
| Discord | `https://auth.alternatefutures.ai/auth/discord/callback` |
| Twitter | `https://auth.alternatefutures.ai/auth/twitter/callback` |

## Security Notes

- `JWT_SECRET` should be shared between service-auth and service-cloud-api
- Use strong, randomly generated secrets (minimum 32 characters)
- Never commit secrets to version control
- Rotate secrets periodically
