# Security Policy

## Overview

The Alternate Clouds Authentication Service handles sensitive user data and authentication flows. We take security seriously and appreciate the security research community's efforts in helping us keep our users safe.

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

**Note**: As this is a pre-1.0 service, we recommend always using the latest version from the `main` branch.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities via one of the following methods:

### Preferred Method: Private Security Advisory
1. Go to the [Security tab](https://github.com/alternatefutures/service-auth/security)
2. Click "Report a vulnerability"
3. Fill out the vulnerability report form
4. Click "Submit report"

### Alternative Method: Email
Send an email to: **security@alternatefutures.ai**

Include the following information:
- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the vulnerability, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We'll acknowledge receipt within 48 hours
- **Initial Assessment**: We'll provide an initial assessment within 5 business days
- **Updates**: We'll keep you informed of our progress
- **Resolution**: We aim to patch critical vulnerabilities within 7 days
- **Credit**: We'll credit you in the security advisory (unless you prefer to remain anonymous)

## Security Measures

This repository implements multiple layers of security:

### Automated Security Scanning
- **CodeQL**: Scans code for security vulnerabilities on every commit
- **Dependabot**: Automatically updates dependencies with known vulnerabilities
- **Dependency Review**: Blocks PRs that introduce vulnerable dependencies
- **NPM Audit**: Regular audits of npm dependencies
- **Secret Scanning**: Scans commits for accidentally committed secrets
- **Claude Code Review**: AI-powered code review for security issues

### Security Best Practices
- All user passwords are hashed using industry-standard algorithms
- JWT tokens use secure random secrets
- Input validation on all endpoints using Zod schemas
- SQL injection protection via parameterized queries
- Rate limiting on authentication endpoints
- CORS properly configured
- Environment variables for sensitive configuration
- No hardcoded secrets or credentials

## Scope

### In Scope
- Authentication bypass vulnerabilities
- SQL injection
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Server-side request forgery (SSRF)
- Remote code execution (RCE)
- Authentication/authorization flaws
- Sensitive data exposure
- Cryptographic vulnerabilities
- JWT vulnerabilities
- Session management issues
- Rate limiting bypass
- OAuth implementation flaws
- SIWE (Sign-In with Ethereum) vulnerabilities

### Out of Scope
- Social engineering attacks
- Denial of Service (DoS) attacks
- Physical attacks
- Issues in third-party dependencies (please report these upstream)
- Issues requiring unlikely user interaction
- Vulnerabilities in outdated/unsupported versions

## Security Disclosure Policy

We follow the principle of **Coordinated Vulnerability Disclosure**:

1. Security researchers privately report vulnerabilities to us
2. We work with the researcher to understand and validate the issue
3. We develop and test a fix
4. We release the fix and publish a security advisory
5. We publicly credit the researcher (if desired)

**Embargo Period**: We request a 90-day embargo period to develop, test, and deploy fixes before public disclosure.

## Bug Bounty Program

We currently do not have a formal bug bounty program. However, we deeply appreciate security research and will:
- Publicly acknowledge researchers who report valid vulnerabilities
- Provide swag/merchandise for significant findings (when available)
- Consider implementing a formal bug bounty program as the project matures

## Security-Related Configuration

### Environment Variables
Ensure these are set securely in production:
- `JWT_SECRET` - Strong random string (min 32 characters)
- `JWT_REFRESH_SECRET` - Different strong random string (min 32 characters)
- `DATABASE_URL` - Secure database connection
- API keys for third-party services (Resend, Twilio, OAuth providers)

### Rate Limiting
Default rate limits (configurable):
- Authentication endpoints: 5 requests/minute per IP
- General endpoints: 100 requests/minute per IP

### Recommended Security Headers
When deploying, ensure these security headers are set:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

## Security Contacts

- **Security Team**: security@alternatefutures.ai
- **Project Maintainer**: @wonderwomancode

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

---

**Last Updated**: 2024-11-12
