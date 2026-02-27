import { Hono } from 'hono';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { refreshTokenSchema } from '../../utils/validators';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';

const app = new Hono();

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
app.post('/refresh', standardRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { refreshToken } = refreshTokenSchema.parse(body);

    // Verify refresh token
    const payload = jwtService.verifyRefreshToken(refreshToken);

    // Check if session exists (including revoked sessions)
    const session = await dbService.getSessionById(payload.sessionId);

    if (!session) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    // Check if session is revoked
    if (session.revoked) {
      return c.json({ error: 'Session has been revoked' }, 401);
    }

    // Check if session is expired
    if (Date.now() > session.expires_at) {
      return c.json({ error: 'Session expired' }, 401);
    }

    // Get user
    const user = await dbService.getUserById(payload.userId);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Rotate refresh token (one-time use) + issue new access token for same session
    const newAccessToken = jwtService.generateAccessTokenForSession(
      user.id,
      payload.sessionId,
      user.email
    );
    const newRefreshToken = jwtService.generateRefreshToken(user.id, payload.sessionId);

    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await dbService.rotateSessionRefreshToken(payload.sessionId, newRefreshToken, newExpiresAt);

    return c.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);

    if (error instanceof Error && error.message.includes('expired')) {
      return c.json({ error: 'Refresh token expired' }, 401);
    }

    if (error instanceof Error && error.message.includes('Invalid')) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    return c.json({ error: 'Failed to refresh token' }, 500);
  }
});

/**
 * POST /auth/logout
 * Logout user and revoke refresh token
 */
app.post('/logout', authMiddleware, async (c) => {
  try {
    const user = requireAuthUser(c);

    // Get refresh token from request body
    const body = await c.req.json();
    const { refreshToken } = body;

    if (refreshToken) {
      // Find and revoke session
      const session = await dbService.getSessionByRefreshToken(refreshToken);

      if (session && session.user_id === user.userId) {
        await dbService.revokeSession(session.id);
      }
    }

    return c.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return c.json({ error: 'Failed to logout' }, 500);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user with organizations
 */
app.get('/me', authMiddleware, async (c) => {
  try {
    const authUser = requireAuthUser(c);

    // Get full user details
    const user = await dbService.getUserById(authUser.userId);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get user's organizations
    const organizations = await dbService.getOrganizationsByUserId(authUser.userId);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        emailVerified: user.email_verified === 1,
        phoneVerified: user.phone_verified === 1,
        createdAt: new Date(user.created_at).toISOString(),
        lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
      },
      organizations: organizations.map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        avatarUrl: org.avatar_url,
        role: org.role,
      })),
    });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

export default app;
