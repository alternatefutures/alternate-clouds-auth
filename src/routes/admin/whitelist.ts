import { Hono } from 'hono';
import { z } from 'zod';
import { whitelistService } from '../../services/whitelist.service';

const app = new Hono();

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
  return c.json({ success: true, entry }, 201);
});

/** DELETE /admin/whitelist/:id — remove by ID */
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await whitelistService.remove(id);
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

export default app;
