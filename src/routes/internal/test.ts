/**
 * Internal Test Endpoints — DEV/TEST ONLY
 *
 * Time-warp and scheduler-trigger endpoints for integration testing.
 * Guarded by: NODE_ENV !== 'production' AND introspection secret.
 *
 * These implement the "Stripe Test Clocks" pattern: instead of waiting
 * real time for trials to expire, tests manipulate timestamps and
 * trigger scheduler ticks on demand.
 */

import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { timingSafeCompare } from '../../utils/crypto';
import { dbService } from '../../services/db.service';
import { tick } from '../../services/trialScheduler';

// Test-only Prisma client — separate instance to avoid private access issues
const prisma = new PrismaClient();

const app = new Hono();

// Hard block in production unless explicitly opted in (staging uses ENABLE_TEST_ENDPOINTS)
app.use('*', async (c, next) => {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
    return c.json({ error: 'Test endpoints are disabled in production' }, 403);
  }

  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (secret) {
    const provided = c.req.header('x-af-introspection-secret');
    if (!provided || !timingSafeCompare(provided, secret)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  return next();
});

/**
 * POST /internal/test/trial-tick
 *
 * Triggers the trial scheduler tick synchronously and returns results.
 * This is equivalent to the hourly cron running, but on demand.
 */
app.post('/trial-tick', async (c) => {
  await tick();
  return c.json({ ok: true, message: 'Trial scheduler tick completed' });
});

/**
 * GET /internal/test/otp/:email
 *
 * Returns the latest unused OTP for a given email.
 * Used by the e2e test script to sign up without needing real email delivery.
 */
app.get('/otp/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const code = await dbService.getVerificationCode(email, 'email');

  if (!code) {
    return c.json({ error: 'No verification code found' }, 404);
  }

  return c.json({
    code: code.code,
    expiresAt: code.expires_at,
    verified: code.verified,
  });
});

/**
 * POST /internal/test/time-warp
 *
 * Manipulates trial/subscription timestamps to simulate time passing.
 * Accepts an org billing ID and a target trial end date.
 *
 * Body: { orgBillingId: string, trialEndsAt: string (ISO 8601) }
 */
app.post('/time-warp', async (c) => {
  const body = await c.req.json() as {
    orgBillingId: string;
    trialEndsAt: string;
  };

  if (!body.orgBillingId || !body.trialEndsAt) {
    return c.json({ error: 'orgBillingId and trialEndsAt required' }, 400);
  }

  const trialEndsAt = new Date(body.trialEndsAt);

  await prisma.organizationBilling.update({
    where: { id: body.orgBillingId },
    data: { trialEndsAt },
  });

  await prisma.subscription.updateMany({
    where: { orgBillingId: body.orgBillingId },
    data: { trialEnd: trialEndsAt },
  });

  return c.json({
    ok: true,
    message: `Trial end warped to ${trialEndsAt.toISOString()}`,
  });
});

/**
 * POST /internal/test/force-activate
 *
 * Converts a TRIALING/TRIAL_EXPIRED/SUSPENDED subscription to ACTIVE.
 * Bypasses Stripe — for integration testing only.
 *
 * Body: { orgBillingId: string }
 */
app.post('/force-activate', async (c) => {
  const body = await c.req.json() as { orgBillingId: string };

  if (!body.orgBillingId) {
    return c.json({ error: 'orgBillingId required' }, 400);
  }

  const sub = await prisma.subscription.findFirst({
    where: {
      orgBillingId: body.orgBillingId,
      status: { in: ['TRIALING', 'TRIAL_EXPIRED', 'SUSPENDED'] },
    },
    include: { plan: true },
  });

  if (!sub) {
    return c.json({ error: 'No convertible subscription found' }, 404);
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await dbService.convertSubscriptionToActive(sub.id, {
    planId: sub.planId,
    seats: sub.seats,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
  });

  await prisma.organizationBilling.update({
    where: { id: body.orgBillingId },
    data: { trialConverted: true },
  });

  return c.json({
    ok: true,
    subscriptionId: sub.id,
    status: 'ACTIVE',
    planName: sub.plan?.name,
    periodEnd: periodEnd.toISOString(),
  });
});

/**
 * POST /internal/test/cleanup
 *
 * Deletes a test user and all cascading data.
 * Body: { email: string }
 */
app.post('/cleanup', async (c) => {
  const body = await c.req.json() as { email: string };

  if (!body.email || !body.email.includes('e2e-lifecycle-')) {
    return c.json({ error: 'Only e2e-lifecycle-* test emails can be cleaned up' }, 400);
  }

  const user = await dbService.getUserByEmail(body.email);
  if (!user) {
    return c.json({ ok: true, message: 'User not found (already cleaned up)' });
  }

  const orgs = await dbService.getOrganizationsByUserId(user.id);

  for (const org of orgs) {
    const billing = await prisma.organizationBilling.findUnique({
      where: { organizationId: org.id },
    });

    if (billing) {
      await prisma.subscription.deleteMany({ where: { orgBillingId: billing.id } });
      await prisma.organizationUsageLedger.deleteMany({ where: { orgBillingId: billing.id } });
      await prisma.organizationUsageBalance.deleteMany({ where: { orgBillingId: billing.id } });
      await prisma.organizationUsageLog.deleteMany({ where: { orgBillingId: billing.id } });
      await prisma.organizationBilling.delete({ where: { id: billing.id } });
    }

    await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  await prisma.authMethod.deleteMany({ where: { userId: user.id } });
  await prisma.authSession.deleteMany({ where: { userId: user.id } });
  await prisma.billingCustomer.deleteMany({ where: { userId: user.id } });
  await prisma.verificationCode.deleteMany({ where: { identifier: body.email } });
  await prisma.authUser.delete({ where: { id: user.id } });

  return c.json({ ok: true, message: `Cleaned up user ${body.email} and ${orgs.length} org(s)` });
});

export default app;
