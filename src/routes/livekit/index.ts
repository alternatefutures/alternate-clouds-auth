import { Hono } from 'hono';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';

/**
 * LiveKit token-mint endpoint for the "Alternate Connect" template.
 *
 * A LiveKit access token is a plain HS256 JWT signed with the API secret, with
 * the room grant under the `video` claim — so we mint it directly with
 * `jsonwebtoken`, no LiveKit SDK dependency needed.
 *
 * ── Trust model (read before assuming this works for any deployment) ─────────
 * This endpoint signs tokens with the key/secret in THIS service's env
 * (`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`). Those must match the key/secret of
 * the LiveKit SFU the token is for. So it works for an AF-operated / dev SFU
 * configured with the same pair — it does NOT magically mint tokens for an
 * arbitrary user's self-hosted `alternate-connect` deployment (that deployment has its
 * own secret, which this service does not hold).
 *
 * Self-hosters of the `alternate-connect` template mint tokens the same way using their
 * own key/secret — copy this route, or use `livekit-server-sdk` / `lk token create`.
 *
 * Unconfigured by default: if the env vars are absent, every call returns 501 so
 * shipping this route is inert in environments that don't run a LiveKit server.
 */
const app = new Hono();

// All routes require an authenticated user (JWT or PAT).
app.use('*', authMiddleware);

const mintSchema = z.object({
  /** Room name to join (created on first join by LiveKit). */
  room: z.string().min(1).max(128),
  /** Participant identity — defaults to the authenticated user's id. */
  identity: z.string().min(1).max(128).optional(),
  /** Display name shown to other participants. */
  name: z.string().max(128).optional(),
  /** Opaque metadata attached to the participant. */
  metadata: z.string().max(2048).optional(),
  /** Allow this participant to publish tracks (default true). */
  canPublish: z.boolean().optional(),
  /** Allow this participant to subscribe to others (default true). */
  canSubscribe: z.boolean().optional(),
  /** Token lifetime in seconds (default 6h, max 24h). */
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
});

/**
 * POST /livekit/token
 * Mint a short-lived LiveKit access token for a room.
 */
app.post('/token', standardRateLimit, async (c) => {
  // Auth first (authMiddleware already gated the route, this is the guaranteed
  // non-null read) so config state is never observable to unauthenticated callers.
  const authUser = requireAuthUser(c);

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  // Optional: the wss:// URL of the SFU, echoed back so clients have everything.
  const url = process.env.LIVEKIT_URL ?? null;

  if (!apiKey || !apiSecret) {
    return c.json(
      {
        error:
          'LiveKit token minting is not configured (set LIVEKIT_API_KEY and LIVEKIT_API_SECRET).',
        code: 'LIVEKIT_NOT_CONFIGURED',
      },
      501
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400);
  }

  const parsed = mintSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400
    );
  }

  const { room, identity, name, metadata, canPublish, canSubscribe, ttlSeconds } =
    parsed.data;
  const sub = identity ?? authUser.userId;
  const ttl = ttlSeconds ?? 6 * 60 * 60; // 6 hours

  // LiveKit VideoGrant lives under the `video` claim; iss=apiKey, sub=identity.
  const token = jwt.sign(
    {
      name,
      metadata,
      video: {
        room,
        roomJoin: true,
        canPublish: canPublish ?? true,
        canSubscribe: canSubscribe ?? true,
        canPublishData: true,
      },
    },
    apiSecret,
    {
      algorithm: 'HS256',
      issuer: apiKey,
      subject: sub,
      notBefore: 0,
      expiresIn: ttl,
    }
  );

  return c.json({
    token,
    identity: sub,
    room,
    url,
    expiresInSeconds: ttl,
  });
});

export default app;
