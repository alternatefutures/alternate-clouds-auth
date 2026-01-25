import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { standardRateLimit } from '../../middleware/ratelimit';
import { decryptFromStorage } from '../../utils/crypto';

const app = new Hono();

const exchangeSchema = z.object({
  code: z.string().min(10),
});

/**
 * POST /auth/exchange
 * Exchange a short-lived OAuth exchange code for tokens.
 *
 * The exchange code is created by the OAuth callback handler and is:
 * - short lived (typically <= 60s)
 * - single use
 */
app.post('/exchange', standardRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { code } = exchangeSchema.parse(body);

    const record = await dbService.getVerificationCode(code, 'oauth_exchange');

    if (!record) {
      return c.json({ error: 'Invalid or expired code' }, 401);
    }

    if (Date.now() > record.expires_at) {
      // burn it if it still exists
      await dbService.markVerificationCodeAsUsed(record.id);
      return c.json({ error: 'Code expired' }, 401);
    }

    let payload: { accessToken: string; refreshToken: string; userId: string; email?: string };
    try {
      // SECURITY: Decrypt the encrypted token payload
      const decryptedPayload = decryptFromStorage(record.code);
      payload = JSON.parse(decryptedPayload) as typeof payload;
    } catch {
      await dbService.markVerificationCodeAsUsed(record.id);
      return c.json({ error: 'Invalid code payload' }, 401);
    }

    await dbService.markVerificationCodeAsUsed(record.id);

    const user = await dbService.getUserById(payload.userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      success: true,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data' }, 400);
    }

    console.error('Exchange error:', error);
    return c.json({ error: 'Failed to exchange code' }, 500);
  }
});

export default app;

