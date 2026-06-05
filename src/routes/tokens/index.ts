import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { TokenService } from '../../services/token.service';
import { jwtService } from '../../services/jwt.service';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';
import { timingSafeCompare } from '../../utils/crypto';
import { subscriptionGuard } from '../../services/subscription.guard';
import { auditLogService } from '../../services/auditLog.service';
import internalRoutes from './internal';

const app = new Hono();
const tokenService = new TokenService(dbService);

// Internal service-to-service API (protected by introspection secret)
app.route('/internal', internalRoutes);

// Most routes require authentication (except validate which is internal)
app.use('/limits', authMiddleware);
app.use('/', authMiddleware);

// Block token creation for suspended subscriptions (reads still allowed)
app.post('/', subscriptionGuard);

// Schema for creating a token
const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  organizationId: z.string().optional(),
  expiresAt: z.number().optional(),
});

/**
 * POST /tokens
 * Create a new personal access token
 */
app.post('/', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);

    // Validate request body
    const body = await c.req.json();
    const { name, organizationId, expiresAt } = createTokenSchema.parse(body);

    // If organizationId provided, verify user is a member
    if (organizationId) {
      const isMember = await dbService.isUserMemberOfOrganization(authUser.userId, organizationId);
      if (!isMember) {
        return c.json({
          error: 'You are not a member of this organization',
          code: 'NOT_ORG_MEMBER',
        }, 403);
      }
    }

    // Create token
    const token = await tokenService.createToken(authUser.userId, name, expiresAt, organizationId);

    await auditLogService.logFromContext(c, {
      userId: authUser.userId,
      eventType: 'PAT_CREATED',
      metadata: { tokenId: token.id, name: token.name, organizationId },
    });

    return c.json({
      success: true,
      token: {
        id: token.id,
        name: token.name,
        organizationId: token.organizationId,
        token: token.token, // Only returned on creation
        expiresAt: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
        createdAt: new Date(token.createdAt).toISOString(),
      },
    }, 201);
  } catch (error: any) {
    console.error('Create token error:', error);

    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation error',
        details: error.issues,
      }, 400);
    }

    // Handle rate limit errors
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      return c.json({
        error: error.message,
        code: 'RATE_LIMIT_EXCEEDED',
        resetAt: error.resetAt,
      }, 429);
    }

    // Handle token limit errors
    if (error.code === 'MAX_TOKENS_EXCEEDED') {
      return c.json({
        error: error.message,
        code: 'MAX_TOKENS_EXCEEDED',
      }, 400);
    }

    // Handle duplicate token name errors
    if (error.code === 'DUPLICATE_TOKEN_NAME') {
      return c.json({
        error: error.message,
        code: 'DUPLICATE_TOKEN_NAME',
      }, 409);
    }

    // Handle invalid token name errors
    if (error.code === 'INVALID_TOKEN_NAME') {
      return c.json({
        error: error.message,
        code: 'INVALID_TOKEN_NAME',
      }, 400);
    }

    return c.json({ error: 'Failed to create token' }, 500);
  }
});

/**
 * GET /tokens
 * List user's personal access tokens
 */
app.get('/', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);

    // List tokens (without token values)
    const tokens = await tokenService.listTokens(authUser.userId);

    return c.json({
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        organizationId: t.organizationId,
        expiresAt: t.expiresAt ? new Date(t.expiresAt).toISOString() : null,
        lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
        createdAt: new Date(t.createdAt).toISOString(),
      })),
    });
  } catch (error) {
    console.error('List tokens error:', error);
    return c.json({ error: 'Failed to list tokens' }, 500);
  }
});

/**
 * DELETE /tokens/:id
 * Delete a personal access token
 */
app.delete('/:id', authMiddleware, standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const tokenId = c.req.param('id');
    if (!tokenId) {
      return c.json({ error: 'Token not found' }, 404);
    }

    // Delete token
    await tokenService.deleteToken(tokenId, authUser.userId);

    await auditLogService.logFromContext(c, {
      userId: authUser.userId,
      eventType: 'PAT_DELETED',
      metadata: { tokenId },
    });

    return c.json({
      success: true,
      message: 'Token deleted successfully',
    });
  } catch (error: any) {
    console.error('Delete token error:', error);

    if (error.message === 'Token not found') {
      return c.json({ error: 'Token not found' }, 404);
    }

    if (error.message.includes('Unauthorized')) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    return c.json({ error: 'Failed to delete token' }, 500);
  }
});

/**
 * POST /tokens/validate
 * Validate a personal access token (internal use)
 * This endpoint does NOT require authentication as it's used to authenticate requests
 */
const validateTokenSchema = z.object({
  token: z.string().min(1),
});

app.post('/validate', standardRateLimit, async (c) => {
  try {
    // Fail closed: introspection secret MUST be configured
    const introspectionSecret = process.env.AUTH_INTROSPECTION_SECRET;
    if (!introspectionSecret) {
      console.error('AUTH_INTROSPECTION_SECRET is not configured — refusing token validation');
      return c.json({ valid: false, error: 'Service misconfigured' }, 500);
    }
    const provided = c.req.header('x-af-introspection-secret');
    if (!provided || !timingSafeCompare(provided, introspectionSecret)) {
      return c.json({ valid: false, error: 'Unauthorized' }, 401);
    }

    // Validate request body
    const body = await c.req.json();
    const { token } = validateTokenSchema.parse(body);

    // First, try to validate as a Personal Access Token (PAT)
    const patResult = await tokenService.validateToken(token);

    if (patResult) {
      // Enrich with basic user profile (helps internal consumers like service-cloud-api)
      const user = await dbService.getUserById(patResult.userId);
      return c.json({
        valid: true,
        userId: patResult.userId,
        tokenId: patResult.tokenId,
        organizationId: patResult.organizationId,
        email: user?.email ?? null,
        displayName: user?.display_name ?? null,
        avatarUrl: user?.avatar_url ?? null,
      });
    }

    // If PAT validation failed, try JWT access token validation
    try {
      const jwtPayload = jwtService.verifyAccessToken(token);
      
      return c.json({
        valid: true,
        userId: jwtPayload.userId,
        tokenId: jwtPayload.sessionId, // Use sessionId as tokenId for JWT
        // JWT tokens don't have organizationId embedded
      });
    } catch {
      // JWT validation also failed
      return c.json({
        valid: false,
        error: 'Invalid or expired token',
      }, 401);
    }
  } catch (error) {
    console.error('Validate token error:', error);

    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation error',
        details: error.issues,
      }, 400);
    }

    return c.json({ error: 'Failed to validate token' }, 500);
  }
});

/**
 * GET /tokens/limits
 * Get rate limits for token creation
 */
app.get('/limits', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);

    // Get rate limit info
    const limits = await tokenService.getRemainingLimit(authUser.userId);

    return c.json({
      rateLimit: {
        remaining: limits.remaining,
        limit: limits.limit,
        resetAt: limits.resetAt.toISOString(),
      },
      tokenLimit: {
        active: limits.activeTokens,
        max: limits.maxActiveTokens,
      },
    });
  } catch (error) {
    console.error('Get limits error:', error);
    return c.json({ error: 'Failed to get limits' }, 500);
  }
});

export default app;
