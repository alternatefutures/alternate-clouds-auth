import { Hono } from 'hono';
import { z } from 'zod';
import { whitelistService } from '../../services/whitelist.service';
import { whitelistRequestService } from '../../services/whitelistRequest.service';
import { emailService } from '../../services/email.service';
import { auditLogService } from '../../services/auditLog.service';

const app = new Hono();

const SIGN_IN_URL = () =>
  process.env.WEB_APP_URL
    ? `${process.env.WEB_APP_URL.replace(/\/$/, '')}/auth`
    : 'https://app.alternatefutures.ai/auth';

const introspectionSecret = () => process.env.AUTH_INTROSPECTION_SECRET;

/**
 * All admin routes require x-af-introspection-secret header.
 */
app.use('*', async (c, next) => {
  const secret = introspectionSecret();
  if (!secret) {
    return c.json({ error: 'Admin endpoints not configured' }, 503);
  }
  const provided = c.req.header('x-af-introspection-secret');
  if (provided !== secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

const addSchema = z.object({
  identifier: z.string().min(1),
  identifierType: z.enum(['email', 'phone', 'wallet']),
  note: z.string().optional(),
});

const checkSchema = z.object({
  identifier: z.string().min(1),
});

/** GET /admin/whitelist — list all entries */
app.get('/', async (c) => {
  const entries = await whitelistService.list();
  return c.json({ entries, count: entries.length, enabled: whitelistService.isEnabled() });
});

/** POST /admin/whitelist — add an identifier */
app.post('/', async (c) => {
  const body = await c.req.json();
  const { identifier, identifierType, note } = addSchema.parse(body);
  const entry = await whitelistService.add(identifier, identifierType, note);
  await auditLogService.logFromContext(c, {
    eventType: 'WHITELIST_MUTATE',
    metadata: {
      action: 'add',
      identifier,
      identifierType,
      note,
      entryId: entry.id,
    },
  });
  return c.json({ success: true, entry }, 201);
});

/** DELETE /admin/whitelist/:id — remove by ID */
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await whitelistService.remove(id);
    await auditLogService.logFromContext(c, {
      eventType: 'WHITELIST_MUTATE',
      metadata: { action: 'remove', entryId: id },
    });
    return c.json({ success: true });
  } catch {
    return c.json({ error: 'Entry not found' }, 404);
  }
});

/** POST /admin/whitelist/check — check if an identifier is whitelisted */
app.post('/check', async (c) => {
  const body = await c.req.json();
  const { identifier } = checkSchema.parse(body);
  const entry = await whitelistService.check(identifier);
  return c.json({ whitelisted: !!entry, entry, enabled: whitelistService.isEnabled() });
});

// ============================================
// REQUESTS — self-service "let me in" submissions.
// Listed and reviewed alongside the whitelist proper because the
// admin tab in the UI lives next to the whitelist tab; keeping the
// routes co-located avoids a second `/admin/*` mount.
// ============================================

/** GET /admin/whitelist/requests — list (optionally filter by status) */
app.get('/requests', async (c) => {
  const statusParam = c.req.query('status');
  const status =
    statusParam === 'PENDING' || statusParam === 'APPROVED' || statusParam === 'DECLINED'
      ? statusParam
      : undefined;
  const [requests, counts] = await Promise.all([
    whitelistRequestService.list(status ? { status } : undefined),
    whitelistRequestService.counts(),
  ]);
  return c.json({ requests, counts });
});

/** POST /admin/whitelist/requests/:id/approve — approve + email user */
app.post('/requests/:id/approve', async (c) => {
  const id = c.req.param('id');
  const reviewedBy = c.req.header('x-af-admin-user') || undefined;
  const updated = await whitelistRequestService.approve(id, reviewedBy);
  if (!updated) return c.json({ error: 'Request not found' }, 404);

  // Approval email is the closing-the-loop step — fire and forget so
  // a Resend outage doesn't surface as a failed approval in the UI.
  void emailService
    .sendWhitelistApproved(updated.email, updated.name, SIGN_IN_URL())
    .catch((err) => console.warn('[admin/whitelist] approval email failed:', err));

  await auditLogService.logFromContext(c, {
    eventType: 'WHITELIST_MUTATE',
    metadata: {
      action: 'request_approve',
      identifier: updated.identifier,
      identifierType: updated.identifierType,
      contactEmail: updated.email,
      requestId: updated.id,
      reviewedBy,
    },
  });

  return c.json({ success: true, request: updated });
});

/** POST /admin/whitelist/requests/:id/decline — mark declined, no email */
app.post('/requests/:id/decline', async (c) => {
  const id = c.req.param('id');
  const reviewedBy = c.req.header('x-af-admin-user') || undefined;
  const updated = await whitelistRequestService.decline(id, reviewedBy);
  if (!updated) return c.json({ error: 'Request not found' }, 404);

  await auditLogService.logFromContext(c, {
    eventType: 'WHITELIST_MUTATE',
    metadata: {
      action: 'request_decline',
      identifier: updated.identifier,
      identifierType: updated.identifierType,
      contactEmail: updated.email,
      requestId: updated.id,
      reviewedBy,
    },
  });

  return c.json({ success: true, request: updated });
});

export default app;
