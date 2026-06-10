import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';

import { timingSafeCompare } from '../../utils/crypto';
import { getSignupCreditCents } from '../../services/db.service';

const app = new Hono();
const prisma = new PrismaClient();

const introspectionSecret = () => process.env.AUTH_INTROSPECTION_SECRET;

app.use('*', async (c, next) => {
  const secret = introspectionSecret();
  if (!secret) {
    return c.json({ error: 'Admin endpoints not configured' }, 503);
  }
  const provided = c.req.header('x-af-introspection-secret');
  if (!provided || !timingSafeCompare(provided, secret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

/** GET /admin/users — all users with billing/subscription data */
app.get('/', async (c) => {
  const users = await prisma.authUser.findMany({
    include: {
      organizationMembers: {
        where: { role: 'OWNER' },
        include: {
          organization: {
            include: {
              billing: {
                include: {
                  subscriptions: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                  },
                  usageBalance: true,
                  usageLedger: {
                    where: { direction: 'CREDIT', reason: 'topup' },
                    select: { amountCents: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = users.map((u) => {
    const ownerMembership = u.organizationMembers[0];
    const org = ownerMembership?.organization;
    const billing = org?.billing;
    const subscription = billing?.subscriptions[0];
    const balance = billing?.usageBalance;
    const totalToppedUp = billing?.usageLedger.reduce(
      (sum, entry) => sum + entry.amountCents,
      0,
    ) ?? 0;

    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
      displayName: u.displayName,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      orgSlug: org?.slug ?? null,
      trialStartedAt: billing?.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: billing?.trialEndsAt?.toISOString() ?? null,
      trialConverted: billing?.trialConverted ?? false,
      subscriptionStatus: subscription?.status ?? null,
      balanceCents: balance?.balanceCents ?? 0,
      totalToppedUp,
    };
  });

  // `config` echoes the canonical billing knobs from this service so
  // the admin dashboard can compute things like "free credits issued"
  // (= users.length × signupCreditCents) without hardcoding a value
  // that might drift from `SIGNUP_CREDIT_CENTS` in our K8s secrets.
  return c.json({
    users: result,
    count: result.length,
    config: {
      signupCreditCents: getSignupCreditCents(),
    },
  });
});

export default app;
