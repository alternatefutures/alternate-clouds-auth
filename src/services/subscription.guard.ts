/**
 * Subscription Guard
 *
 * Middleware and helpers to enforce subscription status.
 * Blocks access for SUSPENDED users.
 */

import { Context, Next } from 'hono';
import { dbService } from './db.service';
import { getAuthUser } from '../middleware/auth';

/**
 * Look up subscription status for a specific org, or fall back to user's first org.
 */
export async function getUserSubscriptionStatus(userId: string, orgId?: string) {
  if (orgId) {
    return dbService.getOrgSubscriptionStatus(orgId);
  }
  const orgs = await dbService.getOrganizationsByUserId(userId);
  if (!orgs.length) return null;

  return dbService.getOrgSubscriptionStatus(orgs[0].id);
}

const BLOCKED_STATUSES: Record<string, { error: string; message: string }> = {
  SUSPENDED: {
    error: 'subscription_suspended',
    message: 'Your subscription is suspended. Please subscribe to continue using this feature.',
  },
  CANCELED: {
    error: 'subscription_canceled',
    message: 'Your subscription has been canceled. Please resubscribe to continue.',
  },
  UNPAID: {
    error: 'subscription_unpaid',
    message: 'Your subscription payment has failed. Please update your payment method.',
  },
  PAST_DUE: {
    error: 'subscription_past_due',
    message: 'Your subscription payment is past due. Please update your payment method to continue.',
  },
  TRIAL_EXPIRED: {
    error: 'trial_expired',
    message: 'Your trial has expired. Please subscribe to continue using this feature.',
  },
};

/**
 * Hono middleware that blocks requests for non-active subscription statuses.
 * Must be placed AFTER authMiddleware.
 *
 * When no subscription is found at all (null status), the user is allowed
 * through — they may be on a free tier or pre-trial. The CANCELED status
 * is caught by BLOCKED_STATUSES if getOrgSubscriptionStatus includes it.
 */
export async function subscriptionGuard(c: Context, next: Next) {
  const user = getAuthUser(c);
  if (!user) return next();

  // Only enforce against the EXPLICIT org context. Without an
  // X-Organization-Id header we must NOT guess the user's first org —
  // that could 403 a team member on the basis of their unrelated personal
  // org. Downstream routes (e.g. AI) already 400 when the header is missing,
  // so passing through here is safe and avoids wrong-org blocks.
  const orgId = c.req.header('X-Organization-Id') || undefined;
  if (!orgId) return next();

  const status = await getUserSubscriptionStatus(user.userId, orgId);

  if (status?.status) {
    const blockedInfo = BLOCKED_STATUSES[status.status];
    if (blockedInfo) {
      return c.json(blockedInfo, 403);
    }
  }

  return next();
}
