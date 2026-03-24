import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { siweService } from '../../services/siwe.service';
import { generateNonce } from '../../utils/otp';
import { walletChallengeRequestSchema, walletVerifySchema, validateSolanaAddress } from '../../utils/validators';
import { strictRateLimit } from '../../middleware/ratelimit';
import { whitelistService } from '../../services/whitelist.service';
import { auditLogService } from '../../services/auditLog.service';
import { generateDeviceFingerprint } from '../../utils/fingerprint';

const app = new Hono();

/**
 * POST /auth/wallet/challenge
 * Generate SIWE challenge for wallet authentication
 */
app.post('/challenge', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { address, chainId } = walletChallengeRequestSchema.parse(body);

    // Solana wallets are accepted by the validator but not yet supported
    if (validateSolanaAddress(address)) {
      return c.json({
        error: 'Solana wallet authentication is not yet supported. Please use an Ethereum wallet (MetaMask, WalletConnect, etc.).',
        code: 'SOLANA_NOT_SUPPORTED',
      }, 501);
    }

    // Generate nonce
    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // Create SIWE message
    const message = siweService.createMessage({
      domain: process.env.DOMAIN || 'alternatefutures.ai',
      address,
      statement: 'Sign in to Alternate Futures with your wallet',
      uri: process.env.APP_URL || 'https://app.alternatefutures.ai',
      version: '1',
      chainId: chainId || 1, // Default to Ethereum mainnet
      nonce,
      issuedAt,
      expirationTime,
    });

    // Store challenge in database using Prisma
    const challengeId = nanoid();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    await dbService.createSIWEChallenge({
      id: challengeId,
      address: address.toLowerCase(),
      message,
      nonce,
      expires_at: expiresAt,
      verified: 0,
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    });

    return c.json({
      success: true,
      message,
      nonce,
      expiresIn: 900, // seconds
    });
  } catch (error) {
    console.error('Wallet challenge error:', error);

    if (error instanceof Error && error.message.includes('validation')) {
      return c.json({ error: 'Invalid wallet address' }, 400);
    }

    return c.json({ error: 'Failed to generate challenge' }, 500);
  }
});

/**
 * POST /auth/wallet/verify
 * Verify wallet signature and issue JWT tokens
 */
app.post('/verify', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { address, signature, message } = walletVerifySchema.parse(body);

    // Solana wallets are accepted by the validator but not yet supported
    if (validateSolanaAddress(address)) {
      return c.json({
        error: 'Solana wallet authentication is not yet supported. Please use an Ethereum wallet.',
        code: 'SOLANA_NOT_SUPPORTED',
      }, 501);
    }

    // Parse nonce from message
    const nonceMatch = message.match(/Nonce: (.+)/);
    if (!nonceMatch) {
      return c.json({ error: 'Invalid message format' }, 400);
    }
    const nonce = nonceMatch[1];

    // Get challenge from database
    const challenge = await dbService.getSIWEChallengeByAddressAndNonce(
      address.toLowerCase(),
      nonce
    );

    if (!challenge) {
      return c.json({ error: 'Challenge not found or already used' }, 404);
    }

    // Check if challenge has expired
    if (Date.now() > challenge.expires_at) {
      return c.json({ error: 'Challenge has expired' }, 400);
    }

    // Verify signature
    const isValid = siweService.verifySignature(message, signature, address);

    if (!isValid) {
      await auditLogService.logFromContext(c, {
        eventType: 'LOGIN_FAILURE',
        metadata: { method: 'wallet', reason: 'invalid_signature', address: address.toLowerCase() },
      });
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Mark challenge as verified
    await dbService.verifySIWEChallenge(challenge.id);

    // Whitelist gate
    const wl = await whitelistService.check403(address);
    if (wl) return c.json(wl.body, wl.status);

    // Check if user exists with this wallet
    let authMethod = await dbService.getAuthMethodByIdentifier(address.toLowerCase(), 'wallet');
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

      // Update auth method last used
      await dbService.updateAuthMethodLastUsed(authMethod.id);

      // Check if existing user has an organization, create one if not
      const existingOrgs = await dbService.getOrganizationsByUserId(user.id);
      if (existingOrgs.length === 0) {
        const orgSlug = `user-${user.id.slice(0, 8)}`;
        const shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
        await dbService.createDefaultOrganizationForUser({
          orgId: nanoid(),
          memberId: nanoid(),
          billingId: nanoid(),
          billingCustomerId: nanoid(),
          subscriptionId: nanoid(),
          userId: user.id,
          orgSlug,
          orgName: `${shortAddress}'s Org`,
        });
      }
    } else {
      // Create new user
      user = await dbService.createUser({
        id: nanoid(),
        email_verified: 0,
        phone_verified: 0,
      });

      // Create auth method
      authMethod = await dbService.createAuthMethod({
        id: nanoid(),
        user_id: user.id,
        method_type: 'wallet',
        identifier: address.toLowerCase(),
        verified: 1,
        is_primary: 1,
      });

      // Create default organization for new user
      const orgSlug = `user-${user.id.slice(0, 8)}`;
      const shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
      await dbService.createDefaultOrganizationForUser({
        orgId: nanoid(),
        memberId: nanoid(),
        billingId: nanoid(),
        billingCustomerId: nanoid(),
        subscriptionId: nanoid(),
        userId: user.id,
        orgSlug,
        orgName: `${shortAddress}'s Org`,
      });
    }

    // Generate JWT tokens
    const { accessToken, refreshToken, sessionId } = jwtService.generateTokenPair(
      user.id,
      user.email
    );

    // Store session in database
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const deviceId = generateDeviceFingerprint(c);
    await dbService.createSession({
      id: sessionId,
      user_id: user.id,
      refresh_token: refreshToken,
      token_family: randomUUID(),
      token_version: 0,
      user_agent: c.req.header('user-agent'),
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      device_id: deviceId,
      expires_at: expiresAt,
      revoked: 0,
    });

    await auditLogService.logFromContext(c, {
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      metadata: { method: 'wallet', address: address.toLowerCase(), deviceId },
    });

    return c.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        walletAddress: address.toLowerCase(),
      },
    });
  } catch (error) {
    console.error('Wallet verify error:', error);

    if (error instanceof Error && error.message.includes('validation')) {
      return c.json({ error: 'Invalid request data' }, 400);
    }

    return c.json({ error: 'Failed to verify signature' }, 500);
  }
});

export default app;
