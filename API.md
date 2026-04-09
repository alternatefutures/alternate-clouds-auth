# Alternate Clouds Authentication API Documentation

Complete API reference for the Alternate Clouds Authentication Service.

## Base URL

```
Development: http://localhost:3000
Production: https://auth.alternatefutures.ai
```

## Authentication

Most endpoints require a JWT access token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Rate Limiting

All endpoints have rate limiting:
- **Strict** (auth endpoints): 5 requests per 15 minutes
- **Standard** (API endpoints): 60 requests per minute
- **Relaxed** (public endpoints): 200 requests per minute

Rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: When the limit resets
- `Retry-After`: Seconds until you can retry (when limit exceeded)

---

## Email Authentication

### Request Verification Code

Send a 6-digit OTP code to the user's email.

**Endpoint:** `POST /auth/email/request`

**Rate Limit:** 5 requests per 15 minutes

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Verification code sent to your email",
  "expiresIn": 600
}
```

**Errors:**
- `400` - Invalid email address
- `429` - Rate limit exceeded
- `500` - Failed to send email

---

### Verify Email Code

Verify the OTP code and issue JWT tokens.

**Endpoint:** `POST /auth/email/verify`

**Rate Limit:** 5 requests per 15 minutes

**Request Body:**
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "displayName": null,
    "avatarUrl": null
  }
}
```

**Errors:**
- `400` - Invalid code, code expired, or max attempts exceeded
- `404` - No verification code found
- `429` - Rate limit exceeded

---

## Web3 Wallet Authentication (SIWE)

### Request Challenge

Generate a Sign-In with Ethereum challenge message.

**Endpoint:** `POST /auth/wallet/challenge`

**Rate Limit:** 5 requests per 15 minutes

**Request Body:**
```json
{
  "address": "0x1234567890123456789012345678901234567890",
  "chainId": 1
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "alternatefutures.ai wants you to sign in with your Ethereum account:\n0x1234567890123456789012345678901234567890\n\nSign in to Alternate Clouds with your wallet\n\nURI: https://app.alternatefutures.ai\nVersion: 1\nChain ID: 1\nNonce: abc123...\nIssued At: 2025-10-11T14:30:00Z\nExpiration Time: 2025-10-11T14:45:00Z",
  "nonce": "abc123...",
  "expiresIn": 900
}
```

**Errors:**
- `400` - Invalid wallet address
- `429` - Rate limit exceeded

---

### Verify Signature

Verify the wallet signature and issue JWT tokens.

**Endpoint:** `POST /auth/wallet/verify`

**Rate Limit:** 5 requests per 15 minutes

**Request Body:**
```json
{
  "address": "0x1234567890123456789012345678901234567890",
  "signature": "0xabcdef...",
  "message": "alternatefutures.ai wants you to sign in..."
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": null,
    "displayName": null,
    "avatarUrl": null,
    "walletAddress": "0x1234567890123456789012345678901234567890"
  }
}
```

**Errors:**
- `400` - Invalid signature, message format, or expired challenge
- `404` - Challenge not found
- `429` - Rate limit exceeded

---

## OAuth Authentication

### Initiate OAuth Flow

Redirect user to OAuth provider (Google, GitHub, etc.).

**Endpoint:** `GET /auth/oauth/:provider`

**Parameters:**
- `:provider` - OAuth provider name (`google`, `github`)
- `redirect_url` (query, optional) - URL to redirect after authentication

**Example:**
```
GET /auth/oauth/google?redirect_url=https://app.alternatefutures.ai/dashboard
```

**Response:** `302 Redirect` to OAuth provider

---

### OAuth Callback

Handle OAuth callback (automatic redirect from provider).

**Endpoint:** `GET /auth/oauth/callback/:provider`

**Parameters:**
- `code` (query) - Authorization code from provider
- `state` (query) - CSRF token

**Response:** `302 Redirect` to app with tokens
```
https://app.alternatefutures.ai?access_token=xxx&refresh_token=yyy
```

---

### List OAuth Providers

Get list of configured OAuth providers.

**Endpoint:** `GET /auth/oauth/providers`

**Response:** `200 OK`
```json
{
  "providers": [
    {
      "name": "google",
      "authUrl": "/auth/oauth/google"
    },
    {
      "name": "github",
      "authUrl": "/auth/oauth/github"
    }
  ]
}
```

---

## Session Management

### Refresh Access Token

Get a new access token using refresh token.

**Endpoint:** `POST /auth/refresh`

**Rate Limit:** 60 requests per minute

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "displayName": "John Doe",
    "avatarUrl": "https://..."
  }
}
```

**Errors:**
- `401` - Invalid, expired, or revoked refresh token

---

### Logout

Revoke refresh token and end session.

**Endpoint:** `POST /auth/logout`

**Authentication:** Required

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### Get Current User

Get authenticated user information.

**Endpoint:** `GET /auth/me`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "phone": null,
    "displayName": "John Doe",
    "avatarUrl": "https://...",
    "emailVerified": true,
    "phoneVerified": false,
    "createdAt": "2025-10-11T14:00:00Z",
    "lastLoginAt": "2025-10-11T14:30:00Z"
  }
}
```

---

## Account Management

### Get Profile

Get user profile and linked auth methods.

**Endpoint:** `GET /account/profile`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "phone": null,
    "displayName": "John Doe",
    "avatarUrl": "https://...",
    "emailVerified": true,
    "phoneVerified": false,
    "createdAt": "2025-10-11T14:00:00Z",
    "lastLoginAt": "2025-10-11T14:30:00Z",
    "authMethods": 3
  }
}
```

---

### Update Profile

Update user display name and avatar.

**Endpoint:** `PATCH /account/profile`

**Authentication:** Required

**Request Body:**
```json
{
  "displayName": "Jane Doe",
  "avatarUrl": "https://example.com/avatar.jpg"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "displayName": "Jane Doe",
    "avatarUrl": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "phoneVerified": false
  }
}
```

**Errors:**
- `400` - Validation error (invalid URL, etc.)

---

### Delete Account

Permanently delete user account and all data.

**Endpoint:** `DELETE /account/profile`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

---

### List Auth Methods

Get all authentication methods linked to the account.

**Endpoint:** `GET /account/methods`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "methods": [
    {
      "id": "method-1",
      "type": "email",
      "provider": null,
      "identifier": "user@example.com",
      "verified": true,
      "isPrimary": true,
      "createdAt": "2025-10-11T14:00:00Z",
      "lastUsedAt": "2025-10-11T14:30:00Z"
    },
    {
      "id": "method-2",
      "type": "oauth",
      "provider": "google",
      "identifier": "google:123456",
      "verified": true,
      "isPrimary": false,
      "createdAt": "2025-10-11T15:00:00Z",
      "lastUsedAt": "2025-10-11T15:00:00Z"
    },
    {
      "id": "method-3",
      "type": "wallet",
      "provider": null,
      "identifier": "0x1234...",
      "verified": true,
      "isPrimary": false,
      "createdAt": "2025-10-11T16:00:00Z",
      "lastUsedAt": null
    }
  ]
}
```

---

### Unlink Auth Method

Remove an authentication method from the account.

**Endpoint:** `DELETE /account/methods/:id`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Auth method removed successfully"
}
```

**Errors:**
- `400` - Cannot remove the only authentication method
- `404` - Auth method not found

---

### Set Primary Method

Set an authentication method as primary.

**Endpoint:** `POST /account/methods/:id/set-primary`

**Authentication:** Required

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Primary auth method updated"
}
```

**Errors:**
- `404` - Auth method not found

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "message": "Optional detailed message"
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request (validation error, invalid input)
- `401` - Unauthorized (invalid/expired token)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

---

## JWT Tokens

### Access Token

- **Purpose:** API authentication
- **Expiry:** 15 minutes (default)
- **Usage:** Include in `Authorization: Bearer <token>` header

### Refresh Token

- **Purpose:** Obtain new access tokens
- **Expiry:** 7 days (default)
- **Usage:** Send to `/auth/refresh` endpoint
- **Storage:** Secure, httpOnly cookie (recommended)

### Token Payload

Access tokens contain:
```json
{
  "userId": "user-123",
  "email": "user@example.com",
  "sessionId": "session-456",
  "type": "access",
  "iat": 1697040000,
  "exp": 1697040900,
  "iss": "alternatefutures-auth",
  "aud": "alternatefutures-app"
}
```

---

## Examples

### Complete Email Auth Flow

```javascript
// 1. Request verification code
const response1 = await fetch('http://localhost:3000/auth/email/request', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});

// 2. User enters code from email

// 3. Verify code
const response2 = await fetch('http://localhost:3000/auth/email/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    code: '123456'
  })
});

const { accessToken, refreshToken, user } = await response2.json();

// 4. Use access token for authenticated requests
const response3 = await fetch('http://localhost:3000/auth/me', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});
```

### Web3 Wallet Auth Flow

```javascript
// 1. Request challenge
const response1 = await fetch('http://localhost:3000/auth/wallet/challenge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address: '0x1234...',
    chainId: 1
  })
});

const { message, nonce } = await response1.json();

// 2. Sign message with wallet (MetaMask, WalletConnect, etc.)
const signature = await ethereum.request({
  method: 'personal_sign',
  params: [message, address]
});

// 3. Verify signature
const response2 = await fetch('http://localhost:3000/auth/wallet/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address, signature, message })
});

const { accessToken, refreshToken, user } = await response2.json();
```

### OAuth Flow

```javascript
// 1. Redirect user to OAuth provider
window.location.href = 'http://localhost:3000/auth/oauth/google?redirect_url=https://app.example.com';

// 2. User authenticates with Google

// 3. OAuth callback redirects back with tokens
// https://app.example.com?access_token=xxx&refresh_token=yyy

// 4. Extract tokens from URL
const params = new URLSearchParams(window.location.search);
const accessToken = params.get('access_token');
const refreshToken = params.get('refresh_token');
```

---

## Security Best Practices

1. **Store tokens securely**
   - Access tokens: Memory or sessionStorage (short-lived)
   - Refresh tokens: httpOnly cookies (recommended) or secure storage

2. **Use HTTPS in production**
   - Never send tokens over HTTP

3. **Implement CSRF protection**
   - OAuth state tokens are handled automatically

4. **Rotate tokens regularly**
   - Use refresh endpoint to get new access tokens

5. **Validate on server**
   - Never trust client-side validation alone

6. **Rate limiting**
   - Respect rate limit headers
   - Implement exponential backoff on 429 errors

---

## Support

- **Documentation:** https://docs.alternatefutures.ai/auth
- **GitHub:** https://github.com/alternatefutures/alternatefutures-auth
- **Email:** support@alternatefutures.ai
