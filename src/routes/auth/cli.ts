import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { createHash } from 'node:crypto';

import { dbService } from '../../services/db.service';
import { TokenService } from '../../services/token.service';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';
import { encryptForStorage, decryptFromStorage, verifyTokenHash } from '../../utils/crypto';

const app = new Hono();
const tokenService = new TokenService(dbService);

const hashSecret = (secret: string) =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

const startSchema = z.object({
  // Optional: caller can request a friendly token name
  name: z.string().min(1).max(100).optional(),
});

/**
 * POST /auth/cli/start
 * Creates a short-lived CLI login session.
 *
 * The CLI should:
 * - open `verificationUrl` in a browser
 * - poll /auth/cli/poll with (verificationSessionId + pollSecret) until token is returned
 */
app.post('/cli/start', standardRateLimit, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name } = startSchema.parse(body);

  const verificationSessionId = nanoid(32);
  const pollSecret = nanoid(32);

  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const appUrl = process.env.APP_URL || 'https://app.alternatefutures.ai';
  const verificationUrl = `${appUrl.replace(/\/$/, '')}/login/${verificationSessionId}`;

  await dbService.createVerificationCode({
    id: nanoid(),
    code_type: 'cli_session',
    identifier: verificationSessionId,
    code: JSON.stringify({
      pollSecretHash: hashSecret(pollSecret),
      token: null,
      name: name || 'CLI Login',
      createdAt: Date.now(),
    }),
    expires_at: expiresAt,
    attempts: 0,
    max_attempts: 50,
    verified: 0,
    ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
  });

  return c.json({
    success: true,
    verificationSessionId,
    pollSecret,
    verificationUrl,
    expiresIn: 600,
  });
});

const approveSchema = z.object({
  verificationSessionId: z.string().min(10),
  name: z.string().min(1).max(100).optional(),
  // Expiration timestamp (ms). If omitted, default to 30 days.
  expiresAt: z.number().optional(),
  organizationId: z.string().optional(),
});

/**
 * POST /auth/cli/approve
 * Called by the web app when the user visits /login/:verificationSessionId.
 * Requires a valid user access token (browser session).
 */
app.post('/cli/approve', standardRateLimit, authMiddleware, async (c) => {
  const authUser = requireAuthUser(c);
  const body = await c.req.json();
  const { verificationSessionId, name, expiresAt, organizationId } =
    approveSchema.parse(body);

  const record = await dbService.getVerificationCode(
    verificationSessionId,
    'cli_session'
  );

  if (!record) {
    return c.json({ error: 'Invalid or expired session' }, 404);
  }

  if (Date.now() > record.expires_at) {
    await dbService.markVerificationCodeAsUsed(record.id);
    return c.json({ error: 'Session expired' }, 400);
  }

  let payload: {
    pollSecretHash: string;
    token: string | null;
    name?: string;
  };
  try {
    payload = JSON.parse(record.code) as typeof payload;
  } catch {
    await dbService.markVerificationCodeAsUsed(record.id);
    return c.json({ error: 'Corrupted session' }, 400);
  }

  if (payload.token) {
    // already approved
    return c.json({ success: true });
  }

  const defaultExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const finalExpiresAt = expiresAt ?? defaultExpiresAt;

  const created = await tokenService.createToken(
    authUser.userId,
    name || payload.name || 'CLI Login',
    finalExpiresAt,
    organizationId
  );

  // SECURITY: Encrypt the PAT token before storing in the session
  const encryptedToken = encryptForStorage(created.token);

  await dbService.updateVerificationCodeValue(
    record.id,
    JSON.stringify({
      ...payload,
      token: encryptedToken, // Encrypted, not plaintext
      approvedAt: Date.now(),
    })
  );

  return c.json({ success: true });
});

const pollSchema = z.object({
  verificationSessionId: z.string().min(10),
  pollSecret: z.string().min(10),
});

/**
 * POST /auth/cli/poll
 * CLI polls this endpoint until it receives a PAT.
 */
app.post('/cli/poll', standardRateLimit, async (c) => {
  const body = await c.req.json();
  const { verificationSessionId, pollSecret } = pollSchema.parse(body);

  const record = await dbService.getVerificationCode(
    verificationSessionId,
    'cli_session'
  );

  if (!record) {
    return c.json({ error: 'Invalid or expired session' }, 404);
  }

  if (Date.now() > record.expires_at) {
    await dbService.markVerificationCodeAsUsed(record.id);
    return c.json({ error: 'Session expired' }, 400);
  }

  let payload: { pollSecretHash: string; token: string | null };
  try {
    payload = JSON.parse(record.code) as typeof payload;
  } catch {
    await dbService.markVerificationCodeAsUsed(record.id);
    return c.json({ error: 'Corrupted session' }, 400);
  }

  if (hashSecret(pollSecret) !== payload.pollSecretHash) {
    // Avoid leaking whether token exists for wrong secret
    return c.json({ error: 'Invalid session secret' }, 401);
  }

  if (!payload.token) {
    return c.json({ status: 'pending' }, 202);
  }

  // One-time retrieval: burn the session record
  await dbService.markVerificationCodeAsUsed(record.id);

  // SECURITY: Decrypt the PAT token before returning
  let decryptedToken: string;
  try {
    decryptedToken = decryptFromStorage(payload.token);
    console.log('[CLI Poll] Decrypted token length:', decryptedToken.length);
    console.log('[CLI Poll] Decrypted token full:', decryptedToken);
  } catch (err) {
    console.error('[CLI Poll] Decryption failed:', err);
    return c.json({ error: 'Failed to retrieve token' }, 500);
  }

  return c.json({
    success: true,
    token: decryptedToken,
  });
});

export default app;

