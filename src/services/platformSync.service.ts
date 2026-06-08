/**
 * Thin best-effort helpers that mirror auth-side membership changes to
 * service-cloud-api's cached platform `OrganizationMember` rows.
 *
 * Kept dependency-free (only `fetch` + env) so BOTH the invites funnel and the
 * seat-billing/disable path can import it without creating an import cycle
 * (invites.service ↔ seatBilling.service both already depend on each other via
 * syncOrgSeats). The auth DB is the source of truth; these calls are advisory.
 */

import type { OrgRole } from '@prisma/client';

/**
 * Push a member's role + project scope to service-cloud-api so the platform DB
 * mirror (used by `assertProjectAccess`) stays in sync. Best-effort: the auth
 * DB is the source of truth, and the platform also refreshes scope on lazy
 * membership sync from `/auth/me`.
 */
export async function pushMemberScopeToPlatform(
  organizationId: string,
  userId: string,
  scope: { role: OrgRole; accessAllProjects: boolean; projectIds: string[] },
): Promise<void> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (!cloudApiUrl) {
    console.warn('[platformSync] CLOUD_API_URL not set — skipping platform scope push');
    return;
  }
  try {
    const res = await fetch(`${cloudApiUrl}/internal/org/member-scope`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-af-introspection-secret': secret } : {}),
      },
      body: JSON.stringify({ organizationId, userId, ...scope }),
    });
    if (!res.ok) {
      console.error(
        `[platformSync] platform scope push returned ${res.status} for org ${organizationId} user ${userId}`,
      );
    }
  } catch (err) {
    console.error('[platformSync] failed to push platform member scope:', err);
  }
}

/**
 * Tell service-cloud-api to drop its cached platform `OrganizationMember` row
 * so a removed user loses platform access immediately (the cloud-api auth
 * fast-path trusts the local row and never re-checks auth once it exists).
 * Best-effort: logged on failure, since the auth DB is the source of truth.
 */
export async function revokePlatformMembership(organizationId: string, userId: string): Promise<void> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (!cloudApiUrl) {
    console.warn('[platformSync] CLOUD_API_URL not set — skipping platform membership revoke');
    return;
  }
  try {
    const res = await fetch(`${cloudApiUrl}/internal/org/member-removed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-af-introspection-secret': secret } : {}),
      },
      body: JSON.stringify({ organizationId, userId }),
    });
    if (!res.ok) {
      console.error(`[platformSync] platform membership revoke returned ${res.status} for org ${organizationId} user ${userId}`);
    }
  } catch (err) {
    console.error('[platformSync] failed to revoke platform membership:', err);
  }
}
