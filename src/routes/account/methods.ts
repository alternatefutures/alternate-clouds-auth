import { Hono } from 'hono';
import { dbService } from '../../services/db.service';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';
import { auditLogService } from '../../services/auditLog.service';

const app = new Hono();

// All routes require authentication
app.use('*', authMiddleware);

/**
 * GET /account/methods
 * Get all linked auth methods for current user
 */
app.get('/', standardRateLimit, async (c) => {
  try {
    const user = requireAuthUser(c);

    // Get all auth methods for user
    const methods = await dbService.getUserAuthMethods(user.userId);

    return c.json({
      methods: methods.map((method) => ({
        id: method.id,
        type: method.method_type,
        provider: method.provider,
        identifier: method.identifier,
        verified: method.verified === 1,
        isPrimary: method.is_primary === 1,
        createdAt: new Date(method.created_at).toISOString(),
        lastUsedAt: method.last_used_at ? new Date(method.last_used_at).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('Get auth methods error:', error);
    return c.json({ error: 'Failed to get auth methods' }, 500);
  }
});

/**
 * DELETE /account/methods/:id
 * Unlink an auth method
 */
app.delete('/:id', standardRateLimit, async (c) => {
  try {
    const user = requireAuthUser(c);
    const methodId = c.req.param('id');

    // Get the auth method
    const method = await dbService.getAuthMethodById(methodId);

    if (!method || method.user_id !== user.userId) {
      return c.json({ error: 'Auth method not found' }, 404);
    }

    // Check if this is the only auth method
    const allMethods = await dbService.getUserAuthMethods(user.userId);

    if (allMethods.length === 1) {
      return c.json({
        error: 'Cannot remove the only authentication method',
      }, 400);
    }

    // Delete the auth method
    await dbService.deleteAuthMethod(methodId);

    await auditLogService.logFromContext(c, {
      userId: user.userId,
      eventType: 'AUTH_METHOD_UNLINK',
      metadata: {
        methodId,
        methodType: method.method_type,
        provider: method.provider ?? null,
      },
    });

    return c.json({
      success: true,
      message: 'Auth method removed successfully',
    });
  } catch (error) {
    console.error('Delete auth method error:', error);
    return c.json({ error: 'Failed to remove auth method' }, 500);
  }
});

/**
 * POST /account/methods/:id/set-primary
 * Set an auth method as primary
 */
app.post('/:id/set-primary', standardRateLimit, async (c) => {
  try {
    const user = requireAuthUser(c);
    const methodId = c.req.param('id');

    // Verify the method belongs to the user
    const method = await dbService.getAuthMethodById(methodId);

    if (!method || method.user_id !== user.userId) {
      return c.json({ error: 'Auth method not found' }, 404);
    }

    // Unset all other primary methods
    await dbService.unsetAllPrimaryAuthMethods(user.userId);

    // Set this method as primary
    await dbService.updateAuthMethod(methodId, { is_primary: 1 });

    return c.json({
      success: true,
      message: 'Primary auth method updated',
    });
  } catch (error) {
    console.error('Set primary method error:', error);
    return c.json({ error: 'Failed to set primary method' }, 500);
  }
});

export default app;
