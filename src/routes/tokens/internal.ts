/**
 * Internal Tokens API
 * Service-to-service endpoint for creating PATs (called by service-cloud-api)
 *
 * Protected by x-af-introspection-secret header
 * (same pattern as /billing/internal).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { TokenService } from '../../services/token.service';
import { timingSafeCompare } from '../../utils/crypto';

const app = new Hono();
const tokenService = new TokenService(dbService);

app.use('*', async (c, next) => {
  const secret = process.env.AUTH_INTROSPECTION_SECRET;

  if (!secret && process.env.NODE_ENV === 'development') {
    return next();
  }

  if (!secret) {
    console.error('[Internal Tokens] AUTH_INTROSPECTION_SECRET not configured');
    return c.json({ error: 'Internal API not configured' }, 503);
  }

  const provided = c.req.header('x-af-introspection-secret');
  if (!provided || !timingSafeCompare(provided, secret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

const createTokenSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1).max(100),
  expiresAt: z.number().optional(),
});

/**
 * POST /tokens/internal/create
 * Create a PAT on behalf of a user (service-to-service).
 * Used by the deploy pipeline to auto-provision API keys.
 */
app.post('/create', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, organizationId, name, expiresAt } = createTokenSchema.parse(body);

    const isMember = await dbService.isUserMemberOfOrganization(userId, organizationId);
    if (!isMember) {
      return c.json({
        error: 'User is not a member of this organization',
        code: 'NOT_ORG_MEMBER',
      }, 403);
    }

    const token = await tokenService.createToken(userId, name, expiresAt, organizationId);

    return c.json({
      success: true,
      token: token.token,
      id: token.id,
      name: token.name,
      organizationId: token.organizationId,
    }, 201);
  } catch (error: any) {
    console.error('[Internal Tokens] Create token error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }

    if (error.code === 'RATE_LIMIT_EXCEEDED' || error.code === 'MAX_TOKENS_EXCEEDED') {
      return c.json({ error: error.message, code: error.code }, 429);
    }

    return c.json({ error: 'Failed to create token' }, 500);
  }
});

export default app;
