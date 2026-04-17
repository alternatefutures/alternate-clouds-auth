/**
 * Internal Audit Range API (Phase 44 / D3a)
 *
 * Service-to-service endpoint that streams the auth half of the audit
 * log for a closed time range. Consumed by the cloud-api JSONL exporter
 * which UNIONs both halves into a single daily file.
 *
 * Protected by the same `x-af-introspection-secret` pattern as
 * `/billing/internal` and `/tokens/validate`. Never expose this on a
 * public path — payloads contain identity dimensions and any operator-
 * supplied breadcrumbs (already redacted at write time, but still
 * sensitive enough to keep behind the introspection wall).
 *
 * Response format: NDJSON / JSON Lines. One row per line so the caller
 * can stream-merge with cloud-api rows without buffering both halves
 * in memory. Field names match the Postgres column names exactly so
 * both halves of the eventual unified file have the same shape.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { timingSafeCompare } from '../../utils/crypto';

const app = new Hono();

app.use('*', async (c, next) => {
  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (!secret) {
    console.error('[Internal Audit] AUTH_INTROSPECTION_SECRET not configured');
    return c.json({ error: 'Internal API not configured' }, 503);
  }
  const provided = c.req.header('x-af-introspection-secret');
  if (!provided || !timingSafeCompare(provided, secret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

const rangeQuerySchema = z.object({
  // Half-open [from, to). ISO8601 strings; exporter passes UTC day
  // boundaries, but the endpoint accepts any range so backfill works.
  from: z.string().datetime(),
  to: z.string().datetime(),
  // Safety cap so a misbehaving caller can't OOM us. Exporter passes
  // `null` and pages instead — see `cursor`.
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  // Cursor pagination on (timestamp, id) — strictly greater than the
  // last row returned. Encoded as `<isoTimestamp>|<id>`.
  cursor: z.string().optional(),
});

app.get('/range', async (c) => {
  const parse = rangeQuerySchema.safeParse(c.req.query());
  if (!parse.success) {
    return c.json({ error: 'Invalid query', issues: parse.error.issues }, 400);
  }
  const { from, to, limit, cursor } = parse.data;

  // Decode optional cursor — { ts, id } where (ts, id) is the
  // exclusive lower bound of the next page.
  let cursorTs: Date | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const sep = cursor.lastIndexOf('|');
    if (sep === -1) return c.json({ error: 'Invalid cursor' }, 400);
    const tsStr = cursor.slice(0, sep);
    cursorId = cursor.slice(sep + 1);
    cursorTs = new Date(tsStr);
    if (Number.isNaN(cursorTs.getTime())) return c.json({ error: 'Invalid cursor' }, 400);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  // Stable order = (timestamp, id). `id` is a cuid so it disambiguates
  // rows that share a millisecond — without this the cursor can skip
  // or re-emit rows on page boundaries.
  const rows = await dbService.prismaClient.auditEvent.findMany({
    where: {
      timestamp: { gte: fromDate, lt: toDate },
      ...(cursorTs && cursorId
        ? {
            OR: [
              { timestamp: { gt: cursorTs } },
              { timestamp: cursorTs, id: { gt: cursorId } },
            ],
          }
        : {}),
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    take: limit ?? 1000,
  });

  const lines = rows.map((r) => JSON.stringify(serializeRow(r))).join('\n');
  const last = rows[rows.length - 1];
  const nextCursor = last ? `${last.timestamp.toISOString()}|${last.id}` : null;
  const hasMore = rows.length === (limit ?? 1000);

  // The body is JSONL — application/x-ndjson. Pagination metadata is
  // returned via headers (so streaming consumers don't have to parse
  // a JSON envelope).
  c.header('content-type', 'application/x-ndjson');
  c.header('x-af-audit-count', String(rows.length));
  c.header('x-af-audit-has-more', hasMore ? '1' : '0');
  if (nextCursor) c.header('x-af-audit-next-cursor', nextCursor);

  return c.body(lines);
});

/**
 * Serialize an `AuditEvent` row for JSONL output.
 *
 * - `timestamp` becomes an ISO8601 string so cross-service merge is a
 *   plain string compare.
 * - Field order mirrors the cloud-api half exactly so the merged file
 *   reads cleanly without per-side branches.
 */
function serializeRow(r: {
  id: string;
  timestamp: Date;
  traceId: string;
  source: string;
  category: string;
  action: string;
  status: string;
  userId: string | null;
  orgId: string | null;
  projectId: string | null;
  serviceId: string | null;
  deploymentId: string | null;
  durationMs: number | null;
  payload: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}) {
  return {
    id: r.id,
    timestamp: r.timestamp.toISOString(),
    traceId: r.traceId,
    source: r.source,
    category: r.category,
    action: r.action,
    status: r.status,
    userId: r.userId,
    orgId: r.orgId,
    projectId: r.projectId,
    serviceId: r.serviceId,
    deploymentId: r.deploymentId,
    durationMs: r.durationMs,
    payload: r.payload,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
  };
}

export default app;
