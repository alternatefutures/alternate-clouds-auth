/**
 * Thin helpers that mirror auth-side membership changes to
 * service-cloud-api's cached platform `OrganizationMember` rows.
 *
 * Kept dependency-free (only `fetch` + env) so BOTH the invites funnel and the
 * seat-billing/disable path can import it without creating an import cycle
 * (invites.service ↔ seatBilling.service both already depend on each other via
 * syncOrgSeats). The auth DB is the source of truth; these calls are advisory
 * BUT security-relevant (the cloud-api fast-path trusts its cached row), so
 * each push retries transient failures before giving up. A push that still
 * fails after retries is logged loudly — the lazy `/auth/me` membership sync
 * is the backstop for scope pushes; revokes have NO backstop, hence the
 * louder log level guidance in the callers.
 */

import type { OrgRole } from '@prisma/client';

const RETRY_DELAYS_MS = [500, 2000];

/**
 * POST to a cloud-api internal endpoint with retries on network errors and
 * 5xx responses. Returns true when the platform acknowledged the push.
 */
async function postToPlatform(path: string, body: Record<string, unknown>): Promise<boolean> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (!cloudApiUrl) {
    console.warn(`[platformSync] CLOUD_API_URL not set — skipping platform push to ${path}`);
    return false;
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`${cloudApiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-af-introspection-secret': secret } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      // 4xx = our request is wrong; retrying won't help.
      if (res.status < 500) {
        console.error(`[platformSync] platform push to ${path} returned ${res.status} — not retrying`);
        return false;
      }
      console.error(`[platformSync] platform push to ${path} returned ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.error(`[platformSync] platform push to ${path} failed (attempt ${attempt + 1}):`, err);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  return false;
}

/**
 * Push a member's role + project scope to service-cloud-api so the platform DB
 * mirror (used by `assertProjectAccess`) stays in sync. The platform also
 * refreshes scope on lazy membership sync from `/auth/me` (backstop).
 */
export async function pushMemberScopeToPlatform(
  organizationId: string,
  userId: string,
  scope: { role: OrgRole; accessAllProjects: boolean; projectIds: string[] },
): Promise<void> {
  await postToPlatform('/internal/org/member-scope', { organizationId, userId, ...scope });
}

/**
 * Tell service-cloud-api to drop its cached platform `OrganizationMember` row
 * so a removed user loses platform access immediately (the cloud-api auth
 * fast-path trusts the local row and never re-checks auth once it exists).
 * No lazy backstop exists for revokes — failure after retries means the user
 * retains platform access until manual reconciliation.
 */
export async function revokePlatformMembership(organizationId: string, userId: string): Promise<void> {
  const ok = await postToPlatform('/internal/org/member-removed', { organizationId, userId });
  if (!ok) {
    console.error(
      `[platformSync] CRITICAL: platform membership revoke FAILED for org ${organizationId} user ${userId} — user retains platform access`,
    );
  }
}

/**
 * Tell service-cloud-api the org was deleted: bulk-drop every cached platform
 * `OrganizationMember` row for it. Without this, ALL former members keep
 * project/shell access via the platform fast-path after the org is gone.
 */
export async function notifyPlatformOrgDeleted(organizationId: string): Promise<void> {
  const ok = await postToPlatform('/internal/org/deleted', { organizationId });
  if (!ok) {
    console.error(
      `[platformSync] CRITICAL: platform org-deleted fan-out FAILED for org ${organizationId} — former members retain platform access`,
    );
  }
}
