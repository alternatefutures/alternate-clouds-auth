import { Hono } from 'hono';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { refreshTokenSchema } from '../../utils/validators';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';
import { auditLogService } from '../../services/auditLog.service';
import { generateDeviceFingerprint } from '../../utils/fingerprint';
import {
  getReplayedRefreshResponse,
  rememberRefreshResponse,
} from '../../services/refreshReplayCache';

const app = new Hono();

/**
 * POST /auth/refresh
 * Refresh access token using refresh token.
 * Implements reuse detection: if a previously-rotated token is presented,
 * the entire token family is revoked (all sessions sharing the same tokenFamily).
 */
app.post('/refresh', standardRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { refreshToken } = refreshTokenSchema.parse(body);

    // Rotation race short-circuit: if this exact refresh token was just
    // successfully rotated within the last ~15s, return the same rotated
    // response instead of re-rotating (which would either burn another
    // rotation needlessly or, worse, trip reuse detection on the third+
    // parallel caller). See `services/refreshReplayCache.ts` for why this
    // exists. MUST run before the JWT/session checks so a stale token
    // presented by a parallel caller never reaches the reuse-detection
    // branch below.
    const replayed = getReplayedRefreshResponse(refreshToken);
    if (replayed) {
      return c.json(replayed as Record<string, unknown>);
    }

    const payload = jwtService.verifyRefreshToken(refreshToken);

    const session = await dbService.getSessionById(payload.sessionId);

    if (!session) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }

    if (session.revoked) {
      return c.json({ error: 'Session has been revoked' }, 401);
    }

    if (Date.now() > session.expires_at) {
      return c.json({ error: 'Session expired' }, 401);
    }

    // SECURITY: Verify the presented refresh token hash matches the stored hash.
    // If it doesn't match, a previously-rotated token is being replayed — revoke the
    // entire token family to invalidate all sessions derived from this lineage.
    //
    // Note: a benign concurrent rotation from the same session is caught earlier
    // by the replay cache above; reaching this branch means either the token
    // was rotated >15s ago (genuine replay attempt) or it was never issued.
    if (!dbService.verifyRefreshTokenHash(refreshToken, session.refresh_token)) {
      const revokedCount = await dbService.revokeTokenFamily(session.token_family);
      await auditLogService.logFromContext(c, {
        userId: session.user_id,
        eventType: 'TOKEN_REFRESH_REUSE',
        metadata: {
          sessionId: session.id,
          tokenFamily: session.token_family,
          revokedSessions: revokedCount,
        },
      });
      return c.json({ error: 'Refresh token reuse detected — all sessions revoked' }, 401);
    }

    // Device fingerprint mismatch detection — log as suspicious but don't block
    const currentDeviceId = generateDeviceFingerprint(c);
    const deviceMismatch = session.device_id != null && session.device_id !== currentDeviceId;
    if (deviceMismatch) {
      await auditLogService.logFromContext(c, {
        userId: session.user_id,
        eventType: 'TOKEN_REFRESH',
        riskScore: 60,
        metadata: {
          sessionId: session.id,
          warning: 'device_mismatch',
          originalDeviceId: session.device_id,
          currentDeviceId,
        },
      });
    }

    const user = await dbService.getUserById(payload.userId);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const newAccessToken = jwtService.generateAccessTokenForSession(
      user.id,
      payload.sessionId,
      user.email
    );
    const newRefreshToken = jwtService.generateRefreshToken(user.id, payload.sessionId);

    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await dbService.rotateSessionRefreshToken(payload.sessionId, newRefreshToken, newExpiresAt);

    if (!deviceMismatch) {
      await auditLogService.logFromContext(c, {
        userId: user.id,
        eventType: 'TOKEN_REFRESH',
        metadata: { sessionId: payload.sessionId },
      });
    }

    const responseBody = {
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    };

    // Cache keyed by the OLD (presented) token so any in-flight parallel
    // caller from the same session that arrives in the next ~15s gets the
    // same rotated tokens back instead of triggering another rotation /
    // family revoke. Only cache successful rotations.
    rememberRefreshResponse(refreshToken, responseBody);

    return c.json(responseBody);
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

    const body = await c.req.json().catch(() => ({}));
    const { refreshToken } = body;

    if (refreshToken) {
      const session = await dbService.getSessionByRefreshToken(refreshToken);

      if (session && session.user_id === user.userId) {
        await dbService.revokeSession(session.id);
        await auditLogService.logFromContext(c, {
          userId: user.userId,
          eventType: 'SESSION_REVOKE',
          metadata: { sessionId: session.id },
        });
      }
    } else if (user.sessionId && !user.sessionId.startsWith('pat:')) {
      await dbService.revokeSession(user.sessionId);
      await auditLogService.logFromContext(c, {
        userId: user.userId,
        eventType: 'SESSION_REVOKE',
        metadata: { sessionId: user.sessionId, method: 'access_token' },
      });
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
