# Contributing to Alternate Clouds Auth Service

First off, thank you for considering contributing to our privacy-focused, censorship-resistant authentication service! 🎉

We welcome contributions from everyone who shares our values of privacy, decentralization, and open-source collaboration.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Security](#security)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Environment** (OS, Node version, etc.)
- **Logs** (if applicable, remove sensitive data!)

**Security bugs**: See [SECURITY.md](SECURITY.md) for responsible disclosure.

### Suggesting Enhancements

We love ideas that improve privacy, security, or usability! Include:

- **Clear use case**
- **Privacy/security implications**
- **Implementation ideas** (if you have them)
- **Alternatives considered**

### Privacy & Security First

All contributions should consider:
- ✅ Data minimization
- ✅ User privacy
- ✅ Censorship resistance
- ✅ Security best practices
- ❌ No tracking or analytics
- ❌ No unnecessary data collection

### Your First Code Contribution

Looking for a good first issue? Check:
- [Good First Issue](https://github.com/alternatefutures/service-auth/labels/good%20first%20issue) label
- [Help Wanted](https://github.com/alternatefutures/service-auth/labels/help%20wanted) label
- [Documentation](https://github.com/alternatefutures/service-auth/labels/documentation) improvements

## Development Setup

### Prerequisites
- Node.js 20+
- npm or pnpm
- SQLite (for local development)
- Git

### Setup Steps

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/service-auth.git
cd service-auth

# 3. Add upstream remote
git remote add upstream https://github.com/alternatefutures/service-auth.git

# 4. Install dependencies
npm install

# 5. Copy environment variables
cp .env.example .env
# Edit .env with your local configuration

# 6. Run database setup
npm run db:setup

# 7. Start development server
npm run dev

# 8. Run tests
npm test
```

### Project Structure

```
service-auth/
├── src/
│   ├── routes/          # API endpoints
│   ├── services/        # Business logic
│   ├── middleware/      # Express middleware
│   └── utils/           # Helpers
├── tests/               # Test files
├── db/                  # Database schema
└── migrations/          # Database migrations
```

## Pull Request Process

### Before Submitting

1. **Create a branch** from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clear, focused commits
   - Add tests for new features
   - Update documentation

3. **Test thoroughly**
   ```bash
   npm test           # Run test suite
   npm run lint       # Check code style
   npm run build      # Ensure it builds
   ```

4. **Keep your branch updated**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

### Submitting the PR

1. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub

3. **PR Title**: Use conventional commits format
   ```
   feat: add Nostr authentication support
   fix: resolve XSS vulnerability in profile update
   docs: improve self-hosting guide
   ```

4. **PR Description** should include:
   - What changed and why
   - Related issues (use "Fixes #123")
   - Screenshots (if UI changes)
   - Testing done
   - Privacy/security considerations

### PR Review Process

- **Automated checks** must pass (tests, linting, security scans)
- **Code review** by at least one maintainer
- **Discussion** if needed
- **Approval** then merge

We aim to review PRs within **48 hours** (weekdays).

## Coding Standards

### TypeScript

- **Use TypeScript** for type safety
- **Strict mode** enabled
- **No `any`** types (use `unknown` if needed)
- **Interfaces over types** for objects

### Code Style

We use **Prettier** and **ESLint**:

```bash
npm run format    # Auto-format code
npm run lint      # Check for issues
```

### Best Practices

**Security**:
```typescript
// ✅ Good: Parameterized queries
db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

// ❌ Bad: SQL injection vulnerability
db.prepare(`SELECT * FROM users WHERE id = '${userId}'`).get();
```

**Privacy**:
```typescript
// ✅ Good: Minimal logging, no PII
logger.info('User authenticated', { method: 'email' });

// ❌ Bad: Logging sensitive data
logger.info('User authenticated', { email: user.email });
```

**Error Handling**:
```typescript
// ✅ Good: Specific error messages
if (!user) {
  return c.json({ error: 'User not found' }, 404);
}

// ❌ Bad: Generic errors
catch (e) {
  return c.json({ error: 'Something went wrong' }, 500);
}
```

### Testing

- **Write tests** for new features
- **Test edge cases** and error paths
- **Mock external services** (email, SMS)
- **Aim for >80% coverage**

```typescript
// Example test
describe('Email Authentication', () => {
  it('should reject invalid email', async () => {
    const response = await app.request('/auth/email/request', {
      method: 'POST',
      body: JSON.stringify({ email: 'invalid' }),
    });

    expect(response.status).toBe(400);
  });
});
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance (deps, tooling)
- `security`: Security fix

### Examples

```bash
feat(auth): add Nostr wallet authentication

Implements NIP-98 HTTP Auth for Nostr-based authentication.
Users can now authenticate using their Nostr private key.

Closes #123

fix(siwe): handle signature verification edge case

Edge case where signature with leading zeros would fail.
Added padding to ensure consistent signature length.

security(tokens): encrypt OAuth tokens at rest

OAuth access/refresh tokens are now encrypted using AES-256-GCM
before storing in database.

BREAKING CHANGE: Requires migration for existing OAuth tokens.
```

### Signing Commits

We **require** signed commits for security:

```bash
# Generate GPG key
gpg --gen-key

# Configure git
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true

# Sign commits
git commit -S -m "feat: add new feature"
```

Learn more: [GitHub GPG Guide](https://docs.github.com/en/authentication/managing-commit-signature-verification)

### DCO Sign-off

Add a sign-off to your commits certifying you wrote the code:

```bash
git commit -s -m "feat: add new feature"
```

This adds:
```
Signed-off-by: Your Name <your.email@example.com>
```

## Security

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

See [SECURITY.md](SECURITY.md) for responsible disclosure process.

### Security Best Practices

- **Never commit secrets** (API keys, passwords, tokens)
- **Use `.env`** for configuration
- **Sanitize inputs** using Zod schemas
- **Use parameterized queries** to prevent SQL injection
- **Validate JWTs** properly
- **Rate limit** all endpoints
- **Think like an attacker** - what could go wrong?

## Privacy Guidelines

### Data Minimization

- **Collect only** what's absolutely necessary
- **Delete data** when no longer needed
- **Hash/encrypt** sensitive data

### No Tracking

- **No analytics** without user consent
- **No IP logging** unless optional and hashed
- **No fingerprinting** (user agents, etc.)
- **No third-party** trackers or scripts

### GDPR Compliance

- Support **data export**
- Support **data deletion**
- **Clear privacy policy**
- **Opt-in** for everything

## Communication

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas, community
- **Discord**: Real-time chat (link in README)
- **Email**: security@alternatefutures.ai (security only)

## Recognition

Contributors are recognized in:
- GitHub contributors page
- Release notes
- Optional: CONTRIBUTORS.md file

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Questions?

Don't hesitate to ask! Open a discussion or reach out.

**Thank you for making the internet more private and free!** 🔒🌍
