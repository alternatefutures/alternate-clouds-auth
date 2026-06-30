/**
 * OAuth service for social authentication
 * Supports Google, GitHub, Twitter, Discord, etc.
 */

export interface OAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

export interface OAuthUserInfo {
  id: string;
  email?: string;
  /**
   * Whether the PROVIDER has verified ownership of `email`. Auto-linking an
   * OAuth identity to an existing email/OTP account is gated on this being
   * true — otherwise a social account with an attacker-set, unverified email
   * matching a victim's could take over their account. (Audit C1, 2026-06-29.)
   */
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export class OAuthService {
  private providers: Map<string, OAuthProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Google OAuth
    if (process.env.GOOGLE_CLIENT_ID) {
      this.providers.set('google', {
        name: 'Google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/oauth/callback/google',
        scope: 'openid email profile',
      });
    }

    // GitHub OAuth
    if (process.env.GITHUB_CLIENT_ID) {
      this.providers.set('github', {
        name: 'GitHub',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/auth/oauth/callback/github',
        scope: 'read:user user:email',
      });
    }

    // Twitter/X OAuth
    if (process.env.TWITTER_CLIENT_ID) {
      this.providers.set('twitter', {
        name: 'Twitter',
        authUrl: 'https://twitter.com/i/oauth2/authorize',
        tokenUrl: 'https://api.twitter.com/2/oauth2/token',
        userInfoUrl: 'https://api.twitter.com/2/users/me',
        clientId: process.env.TWITTER_CLIENT_ID,
        clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
        redirectUri: process.env.TWITTER_REDIRECT_URI || 'http://localhost:3000/auth/oauth/callback/twitter',
        scope: 'tweet.read users.read',
      });
    }

    // Discord OAuth
    if (process.env.DISCORD_CLIENT_ID) {
      this.providers.set('discord', {
        name: 'Discord',
        authUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        userInfoUrl: 'https://discord.com/api/users/@me',
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        redirectUri: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/oauth/callback/discord',
        scope: 'identify email',
      });
    }

    // NOTE: Apple Sign In is currently disabled due to signup issues
    // It requires a different OAuth flow using JWT-based authentication
    // See .env.example for commented out Apple credentials
  }

  /**
   * Get OAuth provider config
   */
  getProvider(providerName: string): OAuthProvider | null {
    return this.providers.get(providerName) || null;
  }

  /**
   * Generate authorization URL with PKCE support
   * @param providerName - The OAuth provider name
   * @param state - CSRF state token
   * @param codeChallenge - PKCE code challenge (S256)
   */
  getAuthorizationUrl(providerName: string, state: string, codeChallenge?: string): string | null {
    const provider = this.getProvider(providerName);
    if (!provider) return null;

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      scope: provider.scope,
      response_type: 'code',
      state,
    });

    // Add PKCE parameters if code challenge is provided
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${provider.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token with PKCE support
   * @param providerName - The OAuth provider name
   * @param code - Authorization code from callback
   * @param codeVerifier - PKCE code verifier (if PKCE was used)
   */
  async exchangeCodeForToken(providerName: string, code: string, codeVerifier?: string): Promise<string> {
    const provider = this.getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not configured`);
    }

    const params = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: provider.redirectUri,
      grant_type: 'authorization_code',
    });

    // Add PKCE code verifier if provided
    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json() as Record<string, any>;
    return data.access_token;
  }

  /**
   * Get user info from OAuth provider
   */
  async getUserInfo(providerName: string, accessToken: string): Promise<OAuthUserInfo> {
    const provider = this.getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not configured`);
    }

    const response = await fetch(provider.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const data = await response.json() as Record<string, any>;

    // Normalize user info based on provider
    return this.normalizeUserInfo(providerName, data);
  }

  /**
   * Normalize user info from different providers
   */
  private normalizeUserInfo(providerName: string, data: any): OAuthUserInfo {
    switch (providerName) {
      case 'google':
        return {
          id: data.id,
          email: data.email,
          // Google userinfo v2 returns `verified_email`; OIDC returns `email_verified`.
          emailVerified: data.verified_email === true || data.email_verified === true,
          name: data.name,
          picture: data.picture,
        };

      case 'github':
        return {
          id: data.id.toString(),
          email: data.email,
          // GitHub only lets a user set a *verified* email they own as the
          // public profile email that `/user` returns, so a present email is
          // provider-verified. (Audit C1, 2026-06-29.)
          emailVerified: !!data.email,
          name: data.name || data.login,
          picture: data.avatar_url,
        };

      case 'twitter':
        return {
          id: data.data?.id || data.id,
          email: data.data?.email || data.email,
          // No email scope is requested for Twitter, so any email here is
          // unverified — never auto-link on it.
          emailVerified: false,
          name: data.data?.name || data.name,
          picture: data.data?.profile_image_url || data.profile_image_url,
        };

      case 'discord':
        return {
          id: data.id,
          email: data.email,
          // Discord's /users/@me returns `verified` for the account email.
          emailVerified: data.verified === true,
          name: data.username,
          picture: data.avatar
            ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
            : undefined,
        };

      default:
        return {
          id: data.id,
          email: data.email,
          // Unknown provider — treat the email as unverified (fail safe).
          emailVerified: false,
          name: data.name,
          picture: data.picture || data.avatar_url,
        };
    }
  }

  /**
   * Get list of configured providers
   */
  getConfiguredProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const oauthService = new OAuthService();
