import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { oauthService } from '../../services/oauth.service';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { standardRateLimit } from '../../middleware/ratelimit';

const app = new Hono();

// Store for OAuth state tokens (in-memory for now, use Redis in production)
const stateStore = new Map<string, { timestamp: number; redirectUrl?: string }>();

// Clean up expired state tokens (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  for (const [state, data] of stateStore.entries()) {
    if (data.timestamp < tenMinutesAgo) {
      stateStore.delete(state);
    }
  }
}, 60 * 1000); // Run every minute

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
    const state = nanoid();
    const redirectUrl = c.req.query('redirect_url');

    // Store state token
    stateStore.set(state, {
      timestamp: Date.now(),
      redirectUrl,
    });

    // Generate authorization URL
    const authUrl = oauthService.getAuthorizationUrl(provider, state);

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

    // Verify state token
    const stateData = stateStore.get(state);
    if (!stateData) {
      return c.json({ error: 'Invalid or expired state token' }, 400);
    }

    // Remove used state token
    stateStore.delete(state);

    // Exchange code for access token
    const accessToken = await oauthService.exchangeCodeForToken(provider, code);

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

    // Build redirect URL with tokens
    const redirectUrl = stateData.redirectUrl || process.env.APP_URL || 'http://localhost:5173';
    const redirectParams = new URLSearchParams({
      access_token: jwtAccessToken,
      refresh_token: refreshToken,
    });

    return c.redirect(`${redirectUrl}?${redirectParams.toString()}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return c.json({ error: 'OAuth authentication failed' }, 500);
  }
});

/**
 * GET /auth/oauth/providers
 * Get list of configured OAuth providers
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

export default app;
