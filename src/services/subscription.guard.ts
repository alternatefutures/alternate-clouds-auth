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

/**
 * Hono middleware that blocks requests if the user's subscription is SUSPENDED.
 * Must be placed AFTER authMiddleware.
 */
export async function subscriptionGuard(c: Context, next: Next) {
  const user = getAuthUser(c);
  if (!user) return next();

  const orgId = c.req.header('X-Organization-Id') || undefined;
  const status = await getUserSubscriptionStatus(user.userId, orgId);

  if (status?.status === 'SUSPENDED') {
    return c.json({
      error: 'subscription_suspended',
      message: 'Your subscription is suspended. Please subscribe to continue using this feature.',
    }, 403);
  }

  return next();
}
