/**
 * Usage Routes
 * Track and view usage metrics
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { dbService, UsageMetricType } from '../../services/db.service';
import { timingSafeCompare } from '../../utils/crypto';

const app = new Hono();

app.use('*', authMiddleware);

const recordUsageSchema = z.object({
  metricType: z.enum(['storage', 'bandwidth', 'compute', 'requests']),
  quantity: z.number().min(0),
  timestamp: z.number().optional(),
});

// Pricing per unit (in cents)
const USAGE_PRICING: Record<UsageMetricType, number> = {
  storage: 0.023,    // $0.023 per GB per month
  bandwidth: 0.09,   // $0.09 per GB
  compute: 0.0001,   // $0.0001 per second
  requests: 0.00001, // $0.00001 per request
};

/**
 * GET /billing/usage/current
 * Get current usage metrics for authenticated user
 */
app.get('/current', async (c) => {
  try {
    const user = requireAuthUser(c);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({
        usage: {
          storage: { quantity: 0, amount: 0 },
          bandwidth: { quantity: 0, amount: 0 },
          compute: { quantity: 0, amount: 0 },
          requests: { quantity: 0, amount: 0 },
          total: 0,
        },
      });
    }

    // Get current billing period
    const subscription = await dbService.getActiveSubscriptionByCustomerId(customer.id);
    let periodStart: number;
    let periodEnd: number;

    if (subscription) {
      periodStart = subscription.current_period_start;
      periodEnd = subscription.current_period_end;
    } else {
      // Default to current month
      const now = new Date();
      periodStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      periodEnd = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() / 1000);
    }

    // Get aggregated usage
    const aggregates = await dbService.getUsageAggregatesByCustomerAndPeriod(customer.id, periodStart, periodEnd);

    const usage: Record<string, { quantity: number; amount: number }> = {
      storage: { quantity: 0, amount: 0 },
      bandwidth: { quantity: 0, amount: 0 },
      compute: { quantity: 0, amount: 0 },
      requests: { quantity: 0, amount: 0 },
    };

    let total = 0;

    for (const agg of aggregates) {
      usage[agg.metric_type] = {
        quantity: agg.total_quantity,
        amount: agg.total_amount,
      };
      total += agg.total_amount;
    }

    return c.json({
      usage: {
        ...usage,
        total,
        periodStart,
        periodEnd,
      },
    });
  } catch (error) {
    console.error('Get current usage error:', error);
    return c.json({ error: 'Failed to get current usage' }, 500);
  }
});

/**
 * GET /billing/usage/history
 * Get usage history
 */
app.get('/history', async (c) => {
  try {
    const user = requireAuthUser(c);
    const limit = parseInt(c.req.query('limit') || '100', 10);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ records: [] });
    }

    const records = await dbService.listUsageRecordsByCustomerId(customer.id);

    return c.json({
      records: records.slice(0, limit).map((r) => ({
        id: r.id,
        metricType: r.metric_type,
        quantity: r.quantity,
        unitPrice: r.unit_price,
        amount: r.amount,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        recordedAt: r.recorded_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Get usage history error:', error);
    return c.json({ error: 'Failed to get usage history' }, 500);
  }
});

/**
 * POST /billing/usage/record
 * Record a usage event (internal service-to-service API)
 */
app.post('/record', async (c) => {
  try {
    const internalSecret = process.env.AUTH_INTROSPECTION_SECRET;
    if (!internalSecret) {
      return c.json({ error: 'Service misconfigured' }, 500);
    }
    const provided = c.req.header('x-af-introspection-secret');
    if (!provided || !timingSafeCompare(provided, internalSecret)) {
      return c.json({ error: 'Unauthorized — internal endpoint' }, 401);
    }

    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = recordUsageSchema.parse(body);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    // Get current subscription
    const subscription = await dbService.getActiveSubscriptionByCustomerId(customer.id);

    // Calculate period
    let periodStart: number;
    let periodEnd: number;

    if (subscription) {
      periodStart = subscription.current_period_start;
      periodEnd = subscription.current_period_end;
    } else {
      const now = new Date();
      periodStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      periodEnd = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime() / 1000);
    }

    // Calculate cost
    const unitPrice = Math.round(USAGE_PRICING[data.metricType] * 100); // Convert to cents
    const amount = Math.round(data.quantity * unitPrice);

    // Record usage
    const record = await dbService.createUsageRecord({
      id: nanoid(),
      customer_id: customer.id,
      subscription_id: subscription?.id,
      metric_type: data.metricType,
      quantity: data.quantity,
      unit_price: unitPrice,
      amount,
      period_start: periodStart,
      period_end: periodEnd,
      recorded_at: data.timestamp || Math.floor(Date.now() / 1000),
    });

    // Update or create aggregate
    const existingAggregate = await dbService.getUsageAggregateByCustomerMetricPeriod(
      customer.id,
      data.metricType,
      periodStart
    );

    if (existingAggregate) {
      await dbService.updateUsageAggregate(existingAggregate.id, {
        total_quantity: existingAggregate.total_quantity + data.quantity,
        total_amount: existingAggregate.total_amount + amount,
      });
    } else {
      await dbService.createUsageAggregate({
        id: nanoid(),
        customer_id: customer.id,
        subscription_id: subscription?.id,
        metric_type: data.metricType,
        total_quantity: data.quantity,
        total_amount: amount,
        period_start: periodStart,
        period_end: periodEnd,
      });
    }

    return c.json({
      record: {
        id: record.id,
        metricType: record.metric_type,
        quantity: record.quantity,
        amount: record.amount,
        recordedAt: record.recorded_at,
      },
    });
  } catch (error) {
    console.error('Record usage error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to record usage' }, 500);
  }
});

export default app;
