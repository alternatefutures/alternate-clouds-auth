import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { oauthService } from '../../services/oauth.service';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { standardRateLimit } from '../../middleware/ratelimit';
import { encryptForStorage, generateCodeVerifier, generateCodeChallenge } from '../../utils/crypto';

const app = new Hono();

// OAuth state is now stored in the database (verification_code table with code_type='oauth_state')
// This enables multi-instance deployments without shared memory
// State data structure stored as JSON in the 'code' field:
interface OAuthStateData {
  redirectUrl?: string;
  codeVerifier: string; // PKCE code verifier
  createdAt: number;
}

function getAllowedRedirectOrigins(): string[] {
  const configured = (process.env.ALLOWED_REDIRECT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const appUrl = process.env.APP_URL ? [process.env.APP_URL] : [];

  // Default allowlist: APP_URL only (plus any explicit origins)
  return Array.from(new Set([...appUrl, ...configured]));
}

function isAllowedRedirectUrl(candidate?: string): boolean {
  if (!candidate) return false;
  try {
    const url = new URL(candidate);
    const allowedOrigins = getAllowedRedirectOrigins();
    return allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

/**
 * GET /auth/oauth/providers
 * Get list of configured OAuth providers
 * NOTE: Must be defined BEFORE /:provider to avoid being caught by wildcard
 */
app.get('/providers', (c) => {
  const providers = oauthService.getConfiguredProviders();

  return c.json({
    providers: providers.map((name) => ({
      name,
      authUrl: `/auth/oauth/${name}`,
    })),
  });
});

/**
 * GET /auth/oauth/:provider
 * Initiate OAuth flow with provider
 */
app.get('/:provider', standardRateLimit, async (c) => {
  try {
    const provider = c.req.param('provider');

    // Check if provider is supported
    const providerConfig = oauthService.getProvider(provider);
    if (!providerConfig) {
      return c.json({
        error: 'Unsupported OAuth provider',
        supportedProviders: oauthService.getConfiguredProviders(),
      }, 400);
    }

    // Generate state token for CSRF protection
    const state = nanoid(32);
    const redirectUrlCandidate = c.req.query('redirect_url');
    const redirectUrl = isAllowedRedirectUrl(redirectUrlCandidate)
      ? redirectUrlCandidate
      : undefined;

    // Generate PKCE values (OAuth 2.1 requirement)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Store state in database for multi-instance support
    const stateData: OAuthStateData = {
      redirectUrl,
      codeVerifier,
      createdAt: Date.now(),
    };
    const stateExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    await dbService.createVerificationCode({
      id: nanoid(),
      code_type: 'oauth_state',
      identifier: state,
      code: JSON.stringify(stateData),
      expires_at: stateExpiresAt,
      attempts: 0,
      max_attempts: 1, // Single use
      verified: 0,
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    });

    // Generate authorization URL with PKCE
    const authUrl = oauthService.getAuthorizationUrl(provider, state, codeChallenge);

    if (!authUrl) {
      return c.json({ error: 'Failed to generate authorization URL' }, 500);
    }

    // Redirect to OAuth provider
    return c.redirect(authUrl);
  } catch (error) {
    console.error('OAuth initiate error:', error);
    return c.json({ error: 'Failed to initiate OAuth flow' }, 500);
  }
});

/**
 * GET /auth/oauth/callback/:provider
 * Handle OAuth callback from provider
 */
app.get('/callback/:provider', async (c) => {
  try {
    const provider = c.req.param('provider');
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    // Check for OAuth error
    if (error) {
      return c.json({ error: `OAuth error: ${error}` }, 400);
    }

    // Validate code and state
    if (!code || !state) {
      return c.json({ error: 'Missing code or state parameter' }, 400);
    }

    // Verify state token from database
    const stateRecord = await dbService.getVerificationCode(state, 'oauth_state');
    if (!stateRecord) {
      return c.json({ error: 'Invalid or expired state token' }, 400);
    }

    // Check if state has expired
    if (Date.now() > stateRecord.expires_at) {
      await dbService.markVerificationCodeAsUsed(stateRecord.id);
      return c.json({ error: 'State token expired' }, 400);
    }

    // Parse state data
    let stateData: OAuthStateData;
    try {
      stateData = JSON.parse(stateRecord.code) as OAuthStateData;
    } catch {
      await dbService.markVerificationCodeAsUsed(stateRecord.id);
      return c.json({ error: 'Invalid state data' }, 400);
    }

    // Mark state as used (single use)
    await dbService.markVerificationCodeAsUsed(stateRecord.id);

    // Exchange code for access token with PKCE code verifier
    const accessToken = await oauthService.exchangeCodeForToken(provider, code, stateData.codeVerifier);

    // Get user info from provider
    const oauthUserInfo = await oauthService.getUserInfo(provider, accessToken);

    // Check if user exists with this OAuth provider
    const identifier = `${provider}:${oauthUserInfo.id}`;
    let authMethod = await dbService.getAuthMethodByIdentifier(identifier, 'oauth');
    let user;

    if (authMethod) {
      // User exists, get their info
      user = await dbService.getUserById(authMethod.user_id);

      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      // Update last login
      await dbService.updateUser(user.id, {
        last_login_at: Date.now(),
      });

      // Update auth method with new token
      await dbService.updateAuthMethod(authMethod.id, {
        oauth_access_token: accessToken,
        last_used_at: Date.now(),
      });

      // Check if existing user has an organization, create one if not
      const existingOrgs = await dbService.getOrganizationsByUserId(user.id);
      if (existingOrgs.length === 0) {
        const orgSlug = `user-${user.id.slice(0, 8)}`;
        const orgName = oauthUserInfo.name || oauthUserInfo.email?.split('@')[0] || 'My Organization';
        await dbService.createDefaultOrganizationForUser({
          orgId: nanoid(),
          memberId: nanoid(),
          billingId: nanoid(),
          billingCustomerId: nanoid(),
          subscriptionId: nanoid(),
          userId: user.id,
          orgSlug,
          orgName: `${orgName}'s Org`,
        });
      }
    } else {
      // Create new user
      user = await dbService.createUser({
        id: nanoid(),
        email: oauthUserInfo.email,
        email_verified: oauthUserInfo.email ? 1 : 0,
        phone_verified: 0,
        display_name: oauthUserInfo.name,
        avatar_url: oauthUserInfo.picture,
      });

      // Create auth method
      authMethod = await dbService.createAuthMethod({
        id: nanoid(),
        user_id: user.id,
        method_type: 'oauth',
        provider,
        identifier,
        oauth_access_token: accessToken,
        verified: 1,
        is_primary: 1,
      });

      // Create default organization for new user
      const orgSlug = `user-${user.id.slice(0, 8)}`;
      const orgName = oauthUserInfo.name || oauthUserInfo.email?.split('@')[0] || 'My Organization';
      await dbService.createDefaultOrganizationForUser({
        orgId: nanoid(),
        memberId: nanoid(),
        billingId: nanoid(),
        billingCustomerId: nanoid(),
        subscriptionId: nanoid(),
        userId: user.id,
        orgSlug,
        orgName: `${orgName}'s Org`,
      });
    }

    // Generate JWT tokens
    const { accessToken: jwtAccessToken, refreshToken, sessionId } = jwtService.generateTokenPair(
      user.id,
      user.email
    );

    // Store session in database
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await dbService.createSession({
      id: sessionId,
      user_id: user.id,
      refresh_token: refreshToken,
      user_agent: c.req.header('user-agent'),
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      expires_at: expiresAt,
      revoked: 0,
    });

    // Create one-time exchange code instead of leaking tokens via URL
    const exchangeCode = nanoid(32);
    const exchangeExpiresAt = Date.now() + 60 * 1000; // 60 seconds

    // SECURITY: Encrypt the token payload before storage
    const tokenPayload = JSON.stringify({
      accessToken: jwtAccessToken,
      refreshToken,
      userId: user.id,
      email: user.email,
    });
    const encryptedPayload = encryptForStorage(tokenPayload);

    await dbService.createVerificationCode({
      id: nanoid(),
      code_type: 'oauth_exchange',
      identifier: exchangeCode,
      code: encryptedPayload, // Encrypted, not plaintext
      expires_at: exchangeExpiresAt,
      attempts: 0,
      max_attempts: 1,
      verified: 0,
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    });

    const redirectUrl = stateData.redirectUrl || process.env.APP_URL || 'http://localhost:5173';
    const redirect = new URL(redirectUrl);
    redirect.searchParams.set('code', exchangeCode);

    return c.redirect(redirect.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    return c.json({ error: 'OAuth authentication failed' }, 500);
  }
});

export default app;
