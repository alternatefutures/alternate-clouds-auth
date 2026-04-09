# Privacy & Censorship-Resistance Roadmap

## Executive Summary

This document outlines improvements to make `service-auth` a best-in-class privacy-focused, censorship-resistant, open-source authentication service.

**Current Status**: ✅ Good Foundation
- No analytics or telemetry
- Decentralized deployment (Akash Network)
- Self-hosted option available
- Open source (MIT License)
- Web3 wallet authentication

**Areas for Improvement**:
- Data minimization
- Enhanced encryption
- Censorship-resistance features
- Privacy documentation
- Open-source governance

---

## 1. Privacy Enhancements

### 1.1 Data Minimization ⚠️ CRITICAL

**Current Issue**: IP addresses and user agents are collected and stored.

**Database tables storing PII**:
- `sessions.ip_address` - User IP at login
- `sessions.user_agent` - Browser fingerprint
- `verification_codes.ip_address` - IP during verification
- `siwe_challenges.ip_address` - IP during wallet auth

**Recommendations**:

#### A. Make IP/User-Agent Collection Optional
```typescript
// Add environment variable
STORE_IP_ADDRESSES=false  // Default to false for privacy
STORE_USER_AGENTS=false   // Default to false for privacy
```

#### B. Hash IP Addresses Instead of Storing Raw
```typescript
// src/utils/privacy.ts
import { sha256 } from '@noble/hashes/sha256';

export function hashIP(ip: string | undefined): string | undefined {
  if (!ip || process.env.STORE_IP_ADDRESSES === 'false') {
    return undefined;
  }

  // Hash with daily salt for fraud detection without identifying users
  const salt = new Date().toISOString().split('T')[0]; // Daily salt
  return Buffer.from(sha256(ip + salt)).toString('hex').substring(0, 16);
}
```

#### C. Add TTL for Sensitive Data
```sql
-- Auto-delete old verification codes (currently stored forever)
CREATE TRIGGER cleanup_old_verification_codes
AFTER INSERT ON verification_codes
BEGIN
  DELETE FROM verification_codes
  WHERE expires_at < (strftime('%s', 'now') * 1000) - 86400000; -- 24h past expiry
END;
```

**Priority**: HIGH
**Effort**: Medium
**Impact**: Major privacy improvement

---

### 1.2 Optional Anonymous Authentication

**Recommendation**: Support truly anonymous authentication methods.

#### A. Nostr-based Authentication
```typescript
// Nostr public key authentication (no email/phone required)
// Users sign a challenge with their Nostr key
interface NostrAuthChallenge {
  pubkey: string;      // Public key only (no identity)
  challenge: string;
  signature: string;
}
```

#### B. Zero-Knowledge Proofs
```typescript
// Allow authentication without revealing identity
// Use zk-SNARKs to prove "I'm a valid user" without revealing who
```

**Priority**: Medium
**Effort**: High
**Impact**: Enables truly anonymous users

---

### 1.3 End-to-End Encryption for User Data

**Current**: Display names and avatar URLs are stored in plaintext.

**Recommendation**: Client-side encryption for profile data.

```typescript
// Client encrypts with their key before sending
interface EncryptedProfile {
  display_name_encrypted: string;  // Encrypted with user's key
  avatar_url_encrypted: string;
  encryption_method: 'aes-256-gcm';
  key_derivation: 'argon2';
}

// Server stores encrypted data, never sees plaintext
// Only user with password/key can decrypt their profile
```

**Priority**: Medium
**Effort**: Medium
**Impact**: Zero-knowledge profile storage

---

### 1.4 Privacy-Preserving Analytics

**Current**: No analytics (good!)

**Recommendation**: IF analytics are needed, use privacy-preserving methods.

```typescript
// Option 1: Plausible Analytics (privacy-first, GDPR compliant)
// Option 2: Self-hosted Matomo with IP anonymization
// Option 3: Simple counter (no user tracking)

interface PrivacyPreservingMetrics {
  // Only aggregate counts, no user identification
  total_authentications: number;
  auth_methods_distribution: Record<string, number>;
  // NO: user IDs, IPs, user agents, timestamps
}
```

**Priority**: Low (only if analytics needed)
**Effort**: Low
**Impact**: Prevents privacy regression

---

### 1.5 OAuth Token Storage Encryption

**Current**: OAuth tokens stored in plaintext.

**Recommendation**: Encrypt OAuth tokens at rest.

```typescript
// Encrypt OAuth tokens before storing
import { encrypt, decrypt } from './utils/encryption';

const encryptedToken = encrypt(oauthAccessToken, ENCRYPTION_KEY);
// Store encryptedToken instead of plaintext
```

**Priority**: HIGH
**Effort**: Medium
**Impact**: Protects third-party account access

---

## 2. Censorship-Resistance Enhancements

### 2.1 Tor Hidden Service Support ✅ EASY WIN

**Recommendation**: Provide .onion address for Tor users.

#### Setup Guide
```bash
# Install Tor
apt-get install tor

# Configure hidden service
# /etc/tor/torrc
HiddenServiceDir /var/lib/tor/auth_service/
HiddenServicePort 80 127.0.0.1:3000

# Get .onion address
cat /var/lib/tor/auth_service/hostname
```

**Documentation needed**:
- `TOR_DEPLOYMENT.md` - Setup guide
- Add .onion address to README
- CORS configuration for .onion domains

**Priority**: HIGH
**Effort**: Low
**Impact**: Major censorship resistance

---

### 2.2 IPFS/Decentralized Storage for Static Assets

**Current**: Avatar URLs point to centralized servers.

**Recommendation**: Support IPFS for avatar storage.

```typescript
interface DecentralizedAvatar {
  url: string;  // Accept ipfs://, ar://, or https://
  storage_type: 'ipfs' | 'arweave' | 'centralized';
}

// Convert IPFS hash to gateway URL
function getAvatarURL(url: string): string {
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.substring(7)}`;
  }
  if (url.startsWith('ar://')) {
    return `https://arweave.net/${url.substring(5)}`;
  }
  return url;
}
```

**Priority**: Medium
**Effort**: Low
**Impact**: Reduces centralized dependencies

---

### 2.3 Multiple DNS/Discovery Methods

**Recommendation**: Don't rely on single DNS.

```bash
# Options for discovering the service:
1. DNS: auth.alternatefutures.ai
2. Tor: <service>.onion
3. IPFS: /ipns/<service-id>
4. ENS: alternatefutures.eth (points to IPFS hash)
5. Handshake: alternatefutures/ (censorship-resistant DNS)
```

**Priority**: Medium
**Effort**: Medium
**Impact**: Multi-layered redundancy

---

### 2.4 Federation Support

**Recommendation**: Allow multiple instances to federate.

```typescript
// Allow users to authenticate across trusted instances
interface FederatedInstance {
  domain: string;
  publicKey: string;  // For verifying tokens
  trusted: boolean;
}

// User can authenticate at instance A, use services at instance B
// Tokens signed by trusted instances are accepted
```

**Priority**: Low
**Effort**: High
**Impact**: Network effect, no single point of failure

---

### 2.5 Offline-First Authentication

**Recommendation**: Support offline authentication methods.

```typescript
// Generate offline codes that work without server
interface OfflineAuthCode {
  code: string;
  validUntil: number;
  usesRemaining: number;
}

// Similar to airplane mode access codes
// Pre-generate codes when online, use when offline/censored
```

**Priority**: Low
**Effort**: Medium
**Impact**: Works during outages/censorship

---

## 3. Open-Source Best Practices

### 3.1 Community Documents 📄 QUICK WINS

**Missing**:
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- GOVERNANCE.md
- PRIVACY_POLICY.md
- CHANGELOG.md

**Create these files**:

#### CONTRIBUTING.md
```markdown
# How to contribute
- Fork → Branch → Commit → PR
- Code style: Prettier + ESLint
- All PRs need tests
- Sign commits (GPG)
- DCO sign-off required
```

#### CODE_OF_CONDUCT.md
```markdown
# Code of Conduct
- Be respectful
- Focus on privacy and security
- No harassment
- Open and welcoming
```

#### PRIVACY_POLICY.md
```markdown
# What we collect
- Email/phone (if you use email/SMS auth)
- Wallet address (if you use wallet auth)
- What we DON'T collect
- Your rights (GDPR, CCPA)
- Data retention: 90 days after account deletion
```

**Priority**: HIGH
**Effort**: Low
**Impact**: Professional open-source project

---

### 3.2 Transparency Reports

**Recommendation**: Publish transparency reports.

```markdown
# Transparency Report Q1 2025

## Data Requests
- Law enforcement requests: 0
- Government requests: 0
- Takedown requests: 0

## Security Incidents
- Breaches: 0
- Vulnerabilities reported: 2 (patched within 7 days)

## Infrastructure
- Instances running: 5 (3 community, 2 official)
- Uptime: 99.9%
```

**Priority**: Medium
**Effort**: Low
**Impact**: Builds trust

---

### 3.3 Security Audit & Bounty Program

**Recommendation**: Third-party security audit.

**Options**:
1. **Trail of Bits** - Top-tier security audit ($50-100k)
2. **Cure53** - Privacy & security specialists ($30-60k)
3. **Open Source Security Foundation** - Free for OSS projects
4. **Community Audit** - Invite security researchers

**Bug Bounty**:
```markdown
# Bug Bounty Program

## Scope
- Authentication bypass: $500-5000
- Data leakage: $200-2000
- XSS/Injection: $100-1000

## Out of Scope
- DoS attacks
- Social engineering
```

**Priority**: HIGH
**Effort**: High
**Impact**: Finds vulnerabilities, builds credibility

---

### 3.4 Reproducible Builds

**Recommendation**: Enable verifiable builds.

```dockerfile
# Dockerfile with fixed versions
FROM node:20.19.0-alpine@sha256:exact-hash
# All dependencies pinned
# Build process deterministic
# Anyone can reproduce exact same binary
```

**Priority**: Medium
**Effort**: Medium
**Impact**: Supply chain security

---

## 4. Technical Improvements

### 4.1 Decentralized Identity (DIDs)

**Recommendation**: Support W3C Decentralized Identifiers.

```typescript
// User can use their DID instead of email
interface DIDAuth {
  did: string;  // did:web:example.com, did:key:..., did:ethr:...
  challenge: string;
  signature: string;
}

// Compatible with: ION, Ceramic, ENS, Unstoppable Domains
```

**Priority**: Medium
**Effort**: High
**Impact**: Interoperable identity

---

### 4.2 Post-Quantum Cryptography

**Recommendation**: Add PQC options for future-proofing.

```typescript
// Hybrid signatures: Ed25519 + Kyber
// Protects against quantum computers
import { kyber } from 'pqc-kyber';

// Dual signature scheme
interface QuantumResistantAuth {
  classicSignature: string;  // Ed25519
  pqcSignature: string;      // Kyber/Dilithium
}
```

**Priority**: Low
**Effort**: High
**Impact**: Future-proof security

---

### 4.3 Rate Limiting Privacy

**Current**: Rate limiting by IP (privacy issue).

**Recommendation**: PrivacyPass/Anonymous credentials.

```typescript
// Issue anonymous tokens for rate limiting
// User proves "I have N valid tokens" without revealing identity
// Similar to Cloudflare PrivacyPass
interface AnonymousRateLimit {
  token: string;  // Blind signature
  // No IP needed
}
```

**Priority**: Low
**Effort**: High
**Impact**: Privacy-preserving DoS protection

---

## 5. Documentation Improvements

### 5.1 Self-Hosting Guide

**Create**: `SELF_HOSTING.md`

```markdown
# Complete self-hosting guide
1. Server requirements
2. Database setup
3. Environment variables
4. Reverse proxy (Caddy/Nginx)
5. Backup procedures
6. Monitoring
7. Updates

# One-click deploys:
- Docker Compose
- Kubernetes Helm chart
- Ansible playbook
```

**Priority**: HIGH
**Effort**: Medium
**Impact**: Empowers self-hosters

---

### 5.2 Privacy FAQ

**Create**: `PRIVACY_FAQ.md`

```markdown
# Privacy FAQ

## What data do you collect?
Minimal. Only what's needed for authentication.

## Do you sell data?
No. Never.

## Can I use this anonymously?
Yes. Use wallet authentication, no email/phone needed.

## Where is data stored?
You choose. Self-host or use our instance.

## How long do you keep data?
90 days after account deletion.
```

**Priority**: HIGH
**Effort**: Low
**Impact**: Transparency

---

## 6. Implementation Priorities

### Phase 1: Quick Wins (1-2 weeks)
1. ✅ Create CONTRIBUTING.md
2. ✅ Create CODE_OF_CONDUCT.md
3. ✅ Create PRIVACY_POLICY.md
4. ✅ Tor deployment guide
5. ✅ Make IP collection optional
6. ✅ Privacy FAQ

### Phase 2: Core Privacy (1 month)
1. ⏳ Hash IP addresses instead of storing raw
2. ⏳ Encrypt OAuth tokens at rest
3. ⏳ TTL for verification codes
4. ⏳ Self-hosting guide
5. ⏳ Data export functionality

### Phase 3: Advanced Features (2-3 months)
1. 🔮 Anonymous authentication (Nostr)
2. 🔮 IPFS avatar support
3. 🔮 .onion hidden service deployment
4. 🔮 DID support
5. 🔮 Security audit

### Phase 4: Future (6+ months)
1. 🔮 Federation support
2. 🔮 Post-quantum cryptography
3. 🔮 Privacy-preserving rate limiting
4. 🔮 Offline authentication

---

## 7. Comparison with Competitors

### Feature Comparison

| Feature | Auth0 | Supabase | Clerk | **ThirdWeb** | **Privy.io** | **Alternate Clouds** |
|---------|-------|----------|-------|--------------|--------------|----------------------|
| **Open Source** | ❌ Proprietary | ✅ Yes | ❌ Proprietary | ❌ Proprietary | ❌ Proprietary | ✅ **MIT License** |
| **Self-Hostable** | ❌ No | ✅ Yes | ❌ No | ❌ No | ❌ No | ✅ **Yes** |
| **No Analytics/Tracking** | ❌ Collects | ❌ Collects | ❌ Collects | ❌ Collects* | ⚠️ Unknown | ✅ **Zero tracking** |
| **Decentralized Deployment** | ❌ No | ❌ No | ❌ No | ❌ Hosted only | ❌ Hosted only | ✅ **Akash Network** |
| **Tor Support** | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No | 🔄 **Roadmap** |
| **Anonymous Auth** | ❌ Requires email/phone | ❌ Requires email | ❌ Requires email | ✅ Wallet-only option | ✅ Wallet-only option | ✅ **Wallet auth** |
| **IP-Free Option** | ❌ Always collects | ❌ Always collects | ❌ Always collects | ⚠️ Unknown | ⚠️ Unknown | 🔄 **Roadmap** |
| **Web3 Wallet Auth** | ⚠️ Limited | ⚠️ Third-party | ⚠️ Limited | ✅ **Primary focus** | ✅ **Primary focus** | ✅ **SIWE + more** |
| **Embedded Wallets** | ❌ No | ❌ No | ❌ No | ✅ Yes | ✅ **Yes** (MPC) | 🔄 Roadmap |
| **Email/SMS Auth** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ **Yes** |
| **OAuth Providers** | ✅ Many | ✅ Several | ✅ Many | ✅ Social login | ✅ Social login | ✅ **10+ providers** |
| **MPC Key Management** | ❌ No | ❌ No | ❌ No | ⚠️ Unknown | ✅ **Yes** (key sharding) | 🔄 Roadmap |
| **Data Encryption at Rest** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Unknown | ✅ **TEE-based** | ✅ **AES-256-GCM** |
| **GDPR Compliant** | ✅ Yes | ✅ Yes | ✅ Yes | ⚠️ Unknown | ⚠️ Unknown | ✅ **Yes** |
| **Pricing** | 💰 Enterprise | 💰 Free tier + paid | 💰 Paid | 💰 Pay-as-you-go | 💰 Enterprise | 🆓 **Free (self-host)** |

\* ThirdWeb includes Google Tag Manager and PostHog analytics on their site

### Key Differentiators

#### **ThirdWeb**
- **Focus**: Web3-first with 500+ wallet connections
- **Strength**: Comprehensive wallet integration, multi-platform SDKs
- **Weakness**: Proprietary, analytics tracking, no self-hosting
- **Best For**: dApps needing extensive wallet support

#### **Privy.io**
- **Focus**: Embedded wallets with MPC security
- **Strength**: Advanced key management (distributed key sharding, TEEs)
- **Weakness**: Proprietary, hosted-only, enterprise pricing
- **Best For**: Apps wanting secure embedded wallets for users
- **Privacy**: Claims to never access user keys via MPC, but closed-source

#### **Alternate Clouds Auth**
- **Focus**: Privacy-first, censorship-resistant authentication
- **Strength**: Open source, self-hostable, decentralized, zero tracking
- **Weakness**: Newer project, embedded wallets not yet implemented
- **Best For**: Privacy-conscious apps, decentralized projects, self-hosters
- **Unique**: Only fully open-source option with Akash deployment

### When to Choose Each

**Choose ThirdWeb if:**
- Building a Web3 app needing extensive wallet integrations
- Need multi-platform SDKs (Unity, Unreal, React Native)
- Willing to use hosted service
- Less concerned about open source

**Choose Privy.io if:**
- Need embedded wallets with MPC security
- Want users without crypto wallets to onboard easily
- Enterprise budget for authentication
- Trust closed-source key management

**Choose Alternate Clouds Auth if:**
- Privacy is non-negotiable
- Want to self-host and control your data
- Need to audit the code (open source)
- Building censorship-resistant applications
- Want decentralized infrastructure (Akash)
- Tight budget (free to self-host)
- Prefer community-driven development

### Market Position

```
           Decentralized ↑
                         |
                         |  ● Alternate Clouds
                         |    (open source + decentralized)
                         |
                         |
                         |  ○ ThirdWeb  ○ Privy
                         |    (Web3-focused, hosted)
                         |
   Open Source ←---------+--------→ Proprietary
                         |
                         |  ○ Supabase
                         |    (open source, centralized)
                         |
                         |  ○ Auth0  ○ Clerk
                         |    (proprietary, enterprise)
                         |
           Centralized ↓
```

### Future Convergence

As the roadmap is implemented, Alternate Clouds Auth will offer:
- ✅ Privacy features (like Privy's MPC, but open source)
- ✅ Web3 features (like ThirdWeb's wallets)
- ✅ Self-hosting (like Supabase)
- ✅ Decentralization (unique to Alternate Clouds)

**Result**: The only authentication service offering all four pillars: **Privacy + Web3 + Self-Hosting + Decentralization**

---

## 8. Metrics for Success

### Privacy Metrics
- [ ] Zero IP addresses stored in plaintext
- [ ] 100% of OAuth tokens encrypted
- [ ] Data minimization score > 90%
- [ ] Anonymous auth option available

### Censorship-Resistance Metrics
- [ ] Tor hidden service active
- [ ] 3+ deployment methods documented
- [ ] 99.9% uptime
- [ ] <1hr failover time

### Open-Source Metrics
- [ ] >100 GitHub stars
- [ ] >10 community contributors
- [ ] Security audit completed
- [ ] Transparency report published

---

## 9. Resources

### Similar Projects to Learn From
- **Ory Kratos** - Privacy-first identity
- **Authentik** - Self-hosted SSO
- **Keycloak** - Open-source IAM
- **Mastodon** - Decentralized social (federation)
- **Signal Protocol** - E2E encryption

### Standards & Specifications
- W3C DID Core
- W3C Verifiable Credentials
- GDPR (EU privacy law)
- CCPA (California privacy law)
- OAuth 2.0 Security Best Practices
- SIWE (EIP-4361)

### Tools
- **Tor** - Censorship resistance
- **IPFS** - Decentralized storage
- **ENS** - Decentralized naming
- **Plausible** - Privacy-first analytics
- **Trail of Bits** - Security audits

---

## Questions?

Open an issue or discussion on GitHub. Let's build the most privacy-focused auth service together! 🔒🌍

**Remember**: Privacy is not a feature. It's a fundamental right.
