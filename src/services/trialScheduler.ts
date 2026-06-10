/**
 * Trial Expiration Scheduler
 *
 * Runs every hour to transition expired trials:
 *   TRIALING → TRIAL_EXPIRED  (when trialEnd passes)
 *   TRIAL_EXPIRED → SUSPENDED (after 3-day grace period)
 *
 * On SUSPENDED: also tells service-cloud-api to pause all active deployments.
 * Sends notification emails at each transition.
 */

import { dbService } from './db.service';
import { emailService } from './email.service';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const GRACE_DAYS = 3;

/**
 * Tell service-cloud-api to shut down all active deployments for an org.
 * Best-effort — failures are logged but don't block the suspension.
 * Exported so subscription cancellation and org deletion reuse the same path.
 */
export async function suspendOrgDeployments(organizationId: string): Promise<void> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  if (!cloudApiUrl) {
    console.warn('[TrialScheduler] CLOUD_API_URL not set — skipping deployment suspension');
    return;
  }

  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  try {
    const res = await fetch(`${cloudApiUrl}/internal/compute/suspend-org`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-af-introspection-secret': secret } : {}),
      },
      body: JSON.stringify({ organizationId }),
    });

    const result = await res.json() as { paused?: string[]; errors?: string[] };

    if (!res.ok) {
      console.error(`[TrialScheduler] suspend-org returned ${res.status}:`, result);
      return;
    }

    if (result.paused?.length) {
      console.log(`[TrialScheduler] Paused ${result.paused.length} deployment(s) for org ${organizationId}:`, result.paused);
    }
    if (result.errors?.length) {
      console.error(`[TrialScheduler] ${result.errors.length} error(s) pausing deployments for org ${organizationId}:`, result.errors);
    }
  } catch (err) {
    console.error(`[TrialScheduler] Failed to call suspend-org for ${organizationId}:`, err);
  }
}

async function processExpiredTrials(): Promise<void> {
  try {
    const expired = await dbService.getExpiredTrials();
    let claimed = 0;
    for (const { subscriptionId, orgBillingId } of expired) {
      // Atomic claim: only the worker that actually flips TRIALING→TRIAL_EXPIRED
      // proceeds to email. In a multi-replica deployment the others get
      // count===0 and skip, so no duplicate emails / double work.
      const won = await dbService.claimTrialExpiry(subscriptionId);
      if (!won) continue;
      claimed++;

      const owner = await dbService.getOrgOwnerEmail(orgBillingId);
      if (owner) {
        await emailService.sendTrialExpiredEmail(owner.email, owner.orgName, owner.orgId, GRACE_DAYS)
          .catch(err => console.error(`[TrialScheduler] Failed to send trial-expired email to ${owner.email}:`, err));
      }

      console.log(`[TrialScheduler] Subscription ${subscriptionId} → TRIAL_EXPIRED`);
    }
    if (claimed) {
      console.log(`[TrialScheduler] Transitioned ${claimed} trial(s) to TRIAL_EXPIRED`);
    }
  } catch (err) {
    console.error('[TrialScheduler] Error processing expired trials:', err);
  }
}

async function processExpiredGracePeriods(): Promise<void> {
  try {
    const expired = await dbService.getExpiredGracePeriods();
    let claimed = 0;
    for (const { subscriptionId, orgBillingId } of expired) {
      // Atomic claim: only the worker that flips TRIAL_EXPIRED→SUSPENDED runs
      // the suspension side effects (email + deployment suspend) exactly once.
      const won = await dbService.claimGraceSuspension(subscriptionId);
      if (!won) continue;
      claimed++;

      const owner = await dbService.getOrgOwnerEmail(orgBillingId);
      if (owner) {
        await emailService.sendAccessSuspendedEmail(owner.email, owner.orgName, owner.orgId)
          .catch(err => console.error(`[TrialScheduler] Failed to send suspended email to ${owner.email}:`, err));
      }

      // Suspend compute REGARDLESS of whether an owner email resolved —
      // gating teardown on `if (owner)` left owner-less/oauth orgs
      // SUSPENDED in the DB while their deployments kept running and
      // burning platform funds (SH12). The email is best-effort; the
      // teardown is not.
      const orgId =
        owner?.orgId ??
        (await dbService.getOrganizationBillingById(orgBillingId))?.organization_id;
      if (orgId) {
        await suspendOrgDeployments(orgId);
      } else {
        console.error(
          `[TrialScheduler] CRITICAL: could not resolve orgId for orgBilling ${orgBillingId} — compute NOT suspended`,
        );
      }

      console.log(`[TrialScheduler] Subscription ${subscriptionId} → SUSPENDED`);
    }
    if (claimed) {
      console.log(`[TrialScheduler] Transitioned ${claimed} subscription(s) to SUSPENDED`);
    }
  } catch (err) {
    console.error('[TrialScheduler] Error processing expired grace periods:', err);
  }
}

export async function tick(): Promise<void> {
  await processExpiredTrials();
  await processExpiredGracePeriods();
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startTrialScheduler(): void {
  console.log('[TrialScheduler] Starting (interval: 1 hour)');

  // Run immediately on startup, then every hour
  tick().catch(err => console.error('[TrialScheduler] Initial tick error:', err));
  intervalHandle = setInterval(() => {
    tick().catch(err => console.error('[TrialScheduler] Tick error:', err));
  }, INTERVAL_MS);
}

export function stopTrialScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[TrialScheduler] Stopped');
  }
}
