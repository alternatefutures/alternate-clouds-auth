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
 * Look up the user's primary org and return its subscription status.
 */
export async function getUserSubscriptionStatus(userId: string) {
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

  const status = await getUserSubscriptionStatus(user.userId);

  if (status?.status === 'SUSPENDED') {
    return c.json({
      error: 'subscription_suspended',
      message: 'Your subscription is suspended. Please subscribe to continue using this feature.',
    }, 403);
  }

  return next();
}
