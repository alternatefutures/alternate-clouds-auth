import { Context, Next } from 'hono';
import { jwtService } from '../services/jwt.service';
import { hashToken } from '../utils/crypto';
import { dbService } from '../services/db.service';

export interface AuthContext {
  userId: string;
  email?: string;
  sessionId: string;
  patOrganizationId?: string;
}

/**
 * Try to resolve a Bearer token as a PAT. Returns AuthContext on success, null on failure.
 */
async function tryPATAuth(token: string): Promise<AuthContext | null> {
  if (!token.startsWith('af_live_') && !token.startsWith('af_test_')) return null;

  const tokenHash = hashToken(token);
  const pat = await dbService.getPersonalAccessTokenByToken(tokenHash);
  if (!pat) return null;

  if (pat.expires_at && pat.expires_at < Date.now()) return null;

  // Fire-and-forget last-used update
  dbService.updatePersonalAccessTokenLastUsed(pat.id).catch(() => {});

  const user = await dbService.getUserById(pat.user_id);

  return {
    userId: pat.user_id,
    email: user?.email,
    sessionId: `pat:${pat.id}`,
    patOrganizationId: pat.organization_id,
  };
}

/**
 * Auth middleware — accepts JWT or PAT Bearer tokens.
 */
export async function authMiddleware(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({ error: 'Authorization header missing' }, 401);
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json({ error: 'Invalid authorization format. Expected: Bearer <token>' }, 401);
    }

    const token = parts[1];

    // Try JWT first (fast, no DB call)
    try {
      const payload = jwtService.verifyAccessToken(token);
      c.set('user', {
        userId: payload.userId,
        email: payload.email,
        sessionId: payload.sessionId,
      } as AuthContext);
      return next();
    } catch {
      // JWT failed — fall through to PAT
    }

    // Try PAT
    const patCtx = await tryPATAuth(token);
    if (patCtx) {
      c.set('user', patCtx);
      return next();
    }

    return c.json({ error: 'Unauthorized' }, 401);
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ error: 'Unauthorized', message: error.message }, 401);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

/**
 * Optional auth middleware - doesn't fail if no token
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  try {
    const authHeader = c.req.header('Authorization');

    if (authHeader) {
      const parts = authHeader.split(' ');

      if (parts.length === 2 && parts[0] === 'Bearer') {
        const token = parts[1];

        // Try JWT first
        try {
          const payload = jwtService.verifyAccessToken(token);
          c.set('user', {
            userId: payload.userId,
            email: payload.email,
            sessionId: payload.sessionId,
          } as AuthContext);
          await next();
          return;
        } catch {
          // Try PAT
        }

        const patCtx = await tryPATAuth(token);
        if (patCtx) {
          c.set('user', patCtx);
        }
      }
    }
  } catch (error) {
    console.warn('Optional auth failed:', error);
  }

  await next();
}

/**
 * Helper to get authenticated user from context
 */
export function getAuthUser(c: Context): AuthContext | null {
  return c.get('user') || null;
}

/**
 * Helper to require authenticated user (throws if not authenticated)
 */
export function requireAuthUser(c: Context): AuthContext {
  const user = getAuthUser(c);

  if (!user) {
    throw new Error('User not authenticated');
  }

  return user;
}
