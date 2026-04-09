# Privacy Policy

**Last Updated**: November 12, 2024

## TL;DR (Too Long; Didn't Read)

- ✅ **We collect minimal data** - only what's needed for authentication
- ✅ **No tracking, analytics, or ads** - ever
- ✅ **You own your data** - export and delete anytime
- ✅ **Open source** - audit our code yourself
- ✅ **Self-hostable** - run your own instance for complete control
- ✅ **Censorship-resistant** - deployed on decentralized infrastructure

---

## Introduction

Alternate Clouds Auth Service ("we", "our", "the service") is a **privacy-focused, open-source authentication system**. This policy explains what data we collect, why, and your rights.

**Philosophy**: We believe privacy is a fundamental human right. We collect the absolute minimum data necessary to provide authentication services.

## What Data We Collect

### Account Data (Required)

Depending on your chosen authentication method:

| Auth Method | Data Collected | Purpose |
|-------------|----------------|---------|
| Email | Email address | Account identification |
| SMS | Phone number (E.164 format) | Account identification |
| Web3 Wallet | Wallet address (public key) | Account identification |
| OAuth (Google, GitHub, etc.) | OAuth user ID, provider name | Account identification |

**Note**: You choose your auth method. Wallet authentication is completely anonymous.

### Optional Profile Data

- Display name (optional)
- Avatar URL (optional)

You can leave these blank for maximum privacy.

### Technical Data

| Data | Collection | Storage | Purpose |
|------|------------|---------|---------|
| IP Address | ⚠️ Optional* | Hashed (if enabled) | Fraud prevention |
| User Agent | ⚠️ Optional* | Hashed (if enabled) | Session management |
| Session Tokens | ✅ Required | Encrypted | Authentication |
| Verification Codes | ✅ Required | Temporary (10 min) | Code verification |

\* **Configurable**: Instance operators can disable IP/User-Agent collection entirely.

### What We DON'T Collect

- ❌ Browsing history
- ❌ Analytics or tracking cookies
- ❌ Third-party ad tracking
- ❌ Device fingerprinting
- ❌ Social graphs or connections
- ❌ Location data
- ❌ Biometric data

## How We Use Your Data

1. **Authentication** - Verify your identity when you log in
2. **Security** - Detect and prevent fraud
3. **Communication** - Send verification codes (email/SMS)
4. **Account Management** - Enable password resets, account deletion

**We will NEVER**:
- Sell your data
- Share with advertisers
- Use for marketing
- Build user profiles
- Track you across websites

## Data Storage

### Where

- **Self-Hosted Instances**: You control where data is stored
- **Official Instance**: Deployed on [Akash Network](https://akash.network/) (decentralized cloud)
- **Database**: SQLite (local) or PostgreSQL (self-hosted)

### How Long

| Data Type | Retention Period |
|-----------|------------------|
| Verification Codes | 10 minutes (then auto-deleted) |
| Active Sessions | Until logout or expiry (default: 30 days) |
| Account Data | Until you delete your account |
| Deleted Accounts | 90 days (then permanently deleted) |

### Security

- ✅ Encryption at rest (AES-256)
- ✅ Encryption in transit (TLS 1.3)
- ✅ OAuth tokens encrypted
- ✅ Passwords never stored (one-time verification codes only)
- ✅ Regular security audits

## Your Rights

### Under GDPR (EU) and CCPA (California)

You have the right to:

1. **Access** - Get a copy of your data
   ```
   GET /account/profile - View your account data
   ```

2. **Delete** - Remove your account permanently
   ```
   DELETE /account/profile - Delete your account
   ```

3. **Export** - Download your data (JSON format)
   ```
   GET /account/export - Download all your data
   ```

4. **Correct** - Update incorrect information
   ```
   PATCH /account/profile - Update your profile
   ```

5. **Object** - Opt-out of data processing
   - For self-hosted instances: Disable IP collection
   - For official instance: Use wallet authentication (no PII)

6. **Portability** - Take your data elsewhere
   - Export via API
   - Self-host your own instance

### How to Exercise Your Rights

**Via API**:
```bash
# Export your data
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://auth.alternatefutures.ai/account/export

# Delete your account
curl -X DELETE \
     -H "Authorization: Bearer YOUR_TOKEN" \
     https://auth.alternatefutures.ai/account/profile
```

**Via Email**: privacy@alternatefutures.ai

**Response Time**: Within 30 days (usually much faster)

## Third-Party Services

We use minimal third-party services:

### Email Delivery (If you use email auth)
- **Provider**: Resend (or your SMTP server if self-hosted)
- **Data Shared**: Your email address, verification code
- **Purpose**: Send verification codes
- **Privacy Policy**: [Resend Privacy](https://resend.com/legal/privacy-policy)

### SMS Delivery (If you use SMS auth)
- **Provider**: Twilio / httpSMS (or your provider if self-hosted)
- **Data Shared**: Your phone number, verification code
- **Purpose**: Send verification codes
- **Privacy Policy**: [Twilio Privacy](https://www.twilio.com/legal/privacy)

### OAuth Providers (If you use social login)
- **Providers**: Google, GitHub, Discord, etc.
- **Data Shared**: OAuth user ID (no passwords)
- **What we receive**: Email/username from provider
- **Their Privacy Policies**: See each provider's policy

**Note**: Self-host to use your own email/SMS providers.

## Cookies

We use **minimal cookies**:

- `refresh_token` (HttpOnly, Secure) - Keep you logged in
- **Duration**: 30 days or until logout
- **No tracking cookies**

You can disable cookies in your browser, but this will prevent authentication.

## Children's Privacy

This service is **not intended for children under 13** (or 16 in the EU). We do not knowingly collect data from children. If you're a parent and believe your child provided data, contact us immediately: privacy@alternatefutures.ai

## International Data Transfers

- **Self-Hosted**: Data stays in your jurisdiction
- **Official Instance**: Data may be transferred internationally
- **Protections**: Standard contractual clauses, encryption

If you're in the EU and concerned about data transfer, we recommend self-hosting.

## Changes to This Policy

We may update this policy occasionally. Changes will be:

1. Posted on this page
2. Dated at the top
3. Announced via:
   - GitHub repository
   - Email (if you opted in)
   - Website banner

**Major changes** require re-acceptance.

## Privacy-Preserving Features

### Anonymous Authentication
Use **Web3 wallet authentication** for complete anonymity:
- No email/phone required
- Just your wallet address (pseudonymous)
- Compatible with: MetaMask, WalletConnect, Phantom

### Tor Support
Access via Tor for censorship resistance:
- `.onion` address available
- No IP logging on Tor
- Perfect forward secrecy

### Self-Hosting
Run your own instance for total control:
- You own all data
- Choose your jurisdiction
- Customize privacy settings
- See [SELF_HOSTING.md](SELF_HOSTING.md)

### Open Source
Audit our code yourself:
- GitHub: [github.com/alternatefutures/service-auth](https://github.com/alternatefutures/service-auth)
- License: MIT
- No hidden tracking

## Contact Us

**General Privacy Questions**: privacy@alternatefutures.ai

**Data Protection Officer**: dpo@alternatefutures.ai

**Security Issues**: See [SECURITY.md](SECURITY.md)

**Mailing Address**:
```
Alternate Clouds
[Address TBD]
```

## Transparency

### Data Breaches
We have **never** had a data breach. If one occurs:
- We'll notify you within 72 hours
- We'll publish a public incident report
- We'll offer mitigation steps

### Government Requests
- **Requests received**: 0
- **Data disclosed**: 0
- **Transparency reports**: Published quarterly

See [TRANSPARENCY_REPORT.md](TRANSPARENCY_REPORT.md) for details.

### Security Audits
- Last audit: [Date TBD]
- Auditor: [Name TBD]
- Findings: [Link to report]

## Legal Basis (GDPR)

We process your data under these legal bases:

1. **Contractual Necessity** - To provide authentication service
2. **Consent** - For optional features (if you opt-in)
3. **Legitimate Interest** - Fraud prevention, security

You can withdraw consent anytime by deleting your account.

## Supervisory Authority

If you're in the EU and unhappy with how we handle data, you can complain to your local data protection authority:
- [List of EU DPAs](https://edpb.europa.eu/about-edpb/about-edpb/members_en)

## Commitment to Privacy

We're committed to being the **most privacy-respecting authentication service** available. This means:

- **Open source** - Full transparency
- **Data minimization** - Collect nothing unnecessary
- **User control** - You own your data
- **Censorship resistance** - Deploy anywhere
- **No tracking** - Ever

**Questions or concerns?** We're here to help: privacy@alternatefutures.ai

---

## Appendix: Technical Details

### Data Encryption

**At Rest**:
- Database encryption: AES-256-GCM
- OAuth tokens: AES-256-GCM
- Refresh tokens: One-way hash (SHA-256)

**In Transit**:
- TLS 1.3 (minimum)
- Perfect forward secrecy
- HSTS enforced

### Data Deletion

When you delete your account:

1. Immediate:
   - Mark account as deleted
   - Revoke all active sessions
   - Delete verification codes

2. Within 24 hours:
   - Delete profile data
   - Delete authentication methods

3. After 90 days:
   - Permanently purge all data
   - Remove from backups
   - Cannot be recovered

### IP Address Handling

If enabled (configurable):
- **Method**: SHA-256 hash with daily salt
- **Storage**: 16-character hash (not reversible)
- **Purpose**: Rate limiting, fraud detection
- **Retention**: 30 days

**Disable entirely**: Set `STORE_IP_ADDRESSES=false`

---

**Remember**: Your privacy is our priority. If you have questions, ask! 🔒
