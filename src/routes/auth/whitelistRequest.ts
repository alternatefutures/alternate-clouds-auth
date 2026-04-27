/**
 * Public route for self-service whitelist requests.
 *
 * Anyone blocked by the early-access gate can POST here with their
 * contact email, the blocked identifier (email or wallet), their name,
 * and a short pitch. We:
 *   1. Persist the row (idempotent on email).
 *   2. Send them a "we got it" confirmation email.
 *   3. Ping Discord (#signups, amber styling) so the team sees it.
 *
 * Rate-limited (strict) so the form can't be used to spam the
 * Discord channel or our SMTP allowance.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { strictRateLimit } from '../../middleware/ratelimit';
import { whitelistRequestService } from '../../services/whitelistRequest.service';
import { emailService } from '../../services/email.service';
import { notifyWhitelistRequest } from '../../lib/discordNotifier';
import { auditLogService } from '../../services/auditLog.service';

const app = new Hono();

const submitSchema = z.object({
  email: z.string().email().max(254),
  identifier: z.string().min(1).max(254).optional(),
  identifierType: z.enum(['email', 'phone', 'wallet']).optional(),
  name: z.string().min(1).max(120),
  reason: z.string().min(1).max(2000),
});

app.post('/', strictRateLimit, async (c) => {
  try {
    const body = await c.req.json();
    const { email, identifier, identifierType, name, reason } = submitSchema.parse(body);

    const ipAddress =
      c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined;
    const userAgent = c.req.header('user-agent') || undefined;

    const result = await whitelistRequestService.create({
      email,
      identifier,
      identifierType,
      name,
      reason,
      ipAddress,
      userAgent,
    });

    if (result.kind === 'already_whitelisted') {
      // Tell the client: don't show "request received", show "you can sign in".
      return c.json({
        status: 'already_whitelisted',
        message: 'This email already has access. Try signing in again.',
      });
    }

    if (result.kind === 'already_requested') {
      return c.json({
        status: 'already_requested',
        message: "We've already received your request — we'll be in touch.",
      });
    }

    // Fire-and-forget side effects: a Resend hiccup or Discord
    // outage shouldn't make the form look broken.
    void emailService
      .sendWhitelistRequestReceived(result.request.email, result.request.name)
      .catch((err) =>
        console.warn('[whitelist-request] confirmation email failed:', err),
      );

    void notifyWhitelistRequest({
      email: result.request.email,
      identifier: result.request.identifier,
      identifierType: result.request.identifierType,
      name: result.request.name,
      reason: result.request.reason,
      ipAddress: result.request.ipAddress,
      createdAt: result.request.createdAt,
    });

    await auditLogService.logFromContext(c, {
      eventType: 'WHITELIST_MUTATE',
      metadata: {
        action: 'request_submitted',
        identifier: result.request.identifier,
        identifierType: result.request.identifierType,
        contactEmail: result.request.email,
        requestId: result.request.id,
      },
    });

    return c.json({
      status: 'created',
      message: "Request received. We'll be in touch.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: err.issues }, 400);
    }
    console.error('Whitelist request error:', err);
    return c.json({ error: 'Failed to submit request' }, 500);
  }
});

export default app;
