/**
 * Internal Billing API
 * Service-to-service endpoints for compute billing (called by service-cloud-api)
 *
 * All endpoints are protected by x-af-introspection-secret header
 * (same pattern as /tokens/validate).
 *
 * These endpoints enable:
 *   - Akash escrow deposits and refunds (wallet debit/credit)
 *   - Phala per-hour compute debits
 *   - Balance and markup queries (for threshold checks)
 *   - Low-balance notification emails
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { EmailService } from '../../services/email.service';
import { timingSafeCompare } from '../../utils/crypto';

const app = new Hono();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// INTROSPECTION SECRET GUARD
// ============================================

/**
 * Middleware: require x-af-introspection-secret header
 * This is the same pattern used by /tokens/validate
 */
app.use('*', async (c, next) => {
  const secret = process.env.AUTH_INTROSPECTION_SECRET;

  if (!secret) {
    console.error('[Internal Billing] AUTH_INTROSPECTION_SECRET not configured');
    return c.json({ error: 'Internal API not configured' }, 503);
  }

  const provided = c.req.header('x-af-introspection-secret');
  if (!provided || !timingSafeCompare(provided, secret)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

// ============================================
// VALIDATION SCHEMAS
// ============================================

const escrowDepositSchema = z.object({
  orgBillingId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  amountCents: z.number().int().positive(),
  deploymentId: z.string().min(1), // AkashDeployment.id (for idempotency)
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const escrowRefundSchema = z.object({
  orgBillingId: z.string().min(1),
  userId: z.string().optional(),
  amountCents: z.number().int().positive(),
  deploymentId: z.string().min(1),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const computeDebitSchema = z.object({
  orgBillingId: z.string().min(1),
  userId: z.string().optional(),
  amountCents: z.number().int().positive(),
  serviceType: z.string().min(1), // 'akash_compute', 'phala_tee', 'storage', etc.
  provider: z.string().min(1), // 'akash', 'phala', 'ipfs', etc.
  resource: z.string().min(1), // deployment ID or resource identifier
  description: z.string().optional(),
  idempotencyKey: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const usageLogSchema = z.object({
  orgBillingId: z.string().min(1),
  userId: z.string().optional(),
  serviceType: z.string().min(1),
  provider: z.string().min(1),
  resource: z.string().min(1),
  model: z.string().optional(),
  usdCostRaw: z.number().nonnegative(),
  marginRate: z.number().min(0),
  usdCharged: z.number().nonnegative(),
  requestId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const notifySchema = z.object({
  orgId: z.string().min(1),
  type: z.enum(['low_balance_pause', 'low_balance_warning', 'escrow_depleted']),
  email: z.string().email().optional().or(z.literal('')), // optional — auth service looks up org admin if empty
  orgName: z.string().optional(),
  balanceCents: z.number().int().optional(),
  dailyCostCents: z.number().int().optional(),
  pausedServices: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Optional dedupe key. When the caller (cloud-api scheduler, QStash
  // retry, etc.) supplies a stable key, we INSERT into
  // `organization_notification_log` first and skip the email send if the
  // INSERT collides on the UNIQUE — gives at-least-once callers
  // exactly-once email semantics.
  idempotencyKey: z.string().min(1).optional(),
});

// ============================================
// ESCROW DEPOSIT — Debit wallet for Akash escrow
// ============================================

/**
 * POST /internal/billing/escrow-deposit
 *
 * Debits the org's wallet to fund an Akash deployment escrow.
 * Returns the new balance or an INSUFFICIENT_BALANCE error.
 *
 * Idempotency key: escrow_deposit:<orgBillingId>:<deploymentId>
 */
app.post('/escrow-deposit', async (c) => {
  let parsedData: z.infer<typeof escrowDepositSchema> | null = null;

  try {
    const body = await c.req.json();
    parsedData = escrowDepositSchema.parse(body);
    const data = parsedData;

    const idempotencyKey = `escrow_deposit:${data.orgBillingId}:${data.deploymentId}`;

    const result = await dbService.debitOrgBalanceAtomic({
      orgBillingId: data.orgBillingId,
      actorUserId: data.userId,
      amountCents: data.amountCents,
      reason: 'akash_escrow_deposit',
      idempotencyKey,
      metadata: {
        deploymentId: data.deploymentId,
        organizationId: data.organizationId,
        description: data.description || 'Akash escrow deposit',
        ...data.metadata,
      },
    });

    return c.json({
      success: true,
      balanceCents: result.balanceCents,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.issues }, 400);
    }
    if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
      if (parsedData) {
        try {
          const balance = await dbService.getOrCreateOrgUsageBalance(parsedData.orgBillingId);
          return c.json({
            error: 'INSUFFICIENT_BALANCE',
            balanceCents: balance.balance_cents,
          }, 402);
        } catch { /* fall through */ }
      }
      return c.json({ error: 'INSUFFICIENT_BALANCE' }, 402);
    }
    console.error('[Internal Billing] Escrow deposit error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// ESCROW REFUND — Credit wallet for Akash escrow return
// ============================================

/**
 * POST /internal/billing/escrow-refund
 *
 * Credits the org's wallet when an Akash deployment is closed
 * and unused escrow is returned.
 *
 * Idempotency key: escrow_refund:<orgBillingId>:<deploymentId>
 */
app.post('/escrow-refund', async (c) => {
  try {
    const body = await c.req.json();
    const data = escrowRefundSchema.parse(body);

    const idempotencyKey = `escrow_refund:${data.orgBillingId}:${data.deploymentId}`;

    const result = await dbService.creditOrgBalanceIdempotent({
      orgBillingId: data.orgBillingId,
      actorUserId: data.userId,
      amountCents: data.amountCents,
      reason: 'akash_escrow_refund',
      idempotencyKey,
      metadata: {
        deploymentId: data.deploymentId,
        description: data.description || 'Akash escrow refund — deployment closed',
        ...data.metadata,
      },
    });

    return c.json({
      success: true,
      balanceCents: result.balanceCents,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.issues }, 400);
    }
    console.error('[Internal Billing] Escrow refund error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// COMPUTE DEBIT — Debit wallet for daily compute charges
// ============================================

/**
 * POST /internal/billing/compute-debit
 *
 * Debits the org's wallet for compute usage (Akash daily cost, Phala hourly billing, etc.)
 * Used by the daily billing job in service-cloud-api.
 *
 * Also logs usage to OrganizationUsageLog + OrganizationUsageCostsPrivate.
 */
app.post('/compute-debit', async (c) => {
  let parsedData: z.infer<typeof computeDebitSchema> | null = null;

  try {
    const body = await c.req.json();
    parsedData = computeDebitSchema.parse(body);
    const data = parsedData;

    // Ensure balance row exists (creates with $0 if new)
    await dbService.getOrCreateOrgUsageBalance(data.orgBillingId);

    // Look up per-plan markup rate
    const marginRate = await dbService.getUsageMarkupForOrg(data.orgBillingId);

    // Calculate raw cost (reverse-engineer from charged amount)
    // chargedCents = rawCents * (1 + marginRate), so rawCents = chargedCents / (1 + marginRate)
    const rawCostCents = Math.round(data.amountCents / (1 + marginRate));
    const rawCostUsd = rawCostCents / 100;
    const chargedUsd = data.amountCents / 100;

    // Debit + usage-log MUST run in one transaction. Previously the two
    // steps were sequential top-level calls: if the usage-log write failed
    // (or the process crashed between them), the wallet was charged with
    // no audit row — invisible from the user dashboard, breaks reconcile.
    const debitResult = await dbService.prismaClient.$transaction(async (tx) => {
      const debit = await dbService.debitOrgBalanceAtomic({
        orgBillingId: data.orgBillingId,
        actorUserId: data.userId,
        amountCents: data.amountCents,
        reason: data.serviceType,
        idempotencyKey: data.idempotencyKey,
        metadata: {
          serviceType: data.serviceType,
          provider: data.provider,
          resource: data.resource,
          description: data.description,
          ...data.metadata,
        },
        tx,
      });

      if (!debit.alreadyProcessed) {
        await dbService.logOrgUsage({
          orgBillingId: data.orgBillingId,
          userId: data.userId || 'system',
          serviceType: data.serviceType,
          provider: data.provider,
          resource: data.resource,
          usdCostRaw: rawCostUsd,
          marginRate,
          usdCharged: chargedUsd,
          metadata: data.metadata,
          tx,
        });
      }

      return debit;
    });

    return c.json({
      success: true,
      balanceCents: debitResult.balanceCents,
      alreadyProcessed: debitResult.alreadyProcessed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.issues }, 400);
    }
    if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
      if (parsedData) {
        try {
          const balance = await dbService.getOrCreateOrgUsageBalance(parsedData.orgBillingId);
          return c.json({
            error: 'INSUFFICIENT_BALANCE',
            balanceCents: balance.balance_cents,
          }, 402);
        } catch {
          // Fall through
        }
      }
      return c.json({ error: 'INSUFFICIENT_BALANCE' }, 402);
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error('[Internal Billing] Compute debit error:', errMsg);
    if (errStack) console.error('[Internal Billing] Stack:', errStack);
    if (parsedData) console.error('[Internal Billing] Request data:', JSON.stringify(parsedData));
    return c.json({ error: 'Internal error', message: errMsg }, 500);
  }
});

// ============================================
// USAGE LOG — Record usage without debiting balance
// ============================================

/**
 * POST /internal/billing/usage-log
 *
 * Records a normalized usage event for display/audit when the financial
 * settlement already happened elsewhere (e.g. Akash escrow consumption).
 */
app.post('/usage-log', async (c) => {
  try {
    const body = await c.req.json();
    const data = usageLogSchema.parse(body);

    const result = await dbService.logOrgUsageIdempotent({
      orgBillingId: data.orgBillingId,
      userId: data.userId,
      serviceType: data.serviceType,
      provider: data.provider,
      resource: data.resource,
      model: data.model,
      usdCostRaw: data.usdCostRaw,
      marginRate: data.marginRate,
      usdCharged: data.usdCharged,
      requestId: data.requestId,
      metadata: data.metadata,
    });

    return c.json({
      success: true,
      usageId: result.usageId,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.issues }, 400);
    }
    console.error('[Internal Billing] Usage log error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// ORG BALANCE — Get wallet balance
// ============================================

/**
 * GET /internal/billing/org-balance/:orgBillingId
 *
 * Returns the org's current wallet balance in cents.
 * Used by the daily billing job for threshold checks.
 */
app.get('/org-balance/:orgBillingId', async (c) => {
  try {
    const { orgBillingId } = c.req.param();
    const balance = await dbService.getOrCreateOrgUsageBalance(orgBillingId);

    return c.json({
      orgBillingId,
      balanceCents: balance.balance_cents,
      balanceUsd: (balance.balance_cents / 100).toFixed(2),
    });
  } catch (error) {
    console.error('[Internal Billing] Get balance error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// ORG MARKUP — Get plan-specific margin rate
// ============================================

/**
 * GET /internal/billing/org-markup/:orgBillingId
 *
 * Returns the org's plan-specific usage markup rate.
 * Used by cloud-api to calculate costs with correct margin.
 */
app.get('/org-markup/:orgBillingId', async (c) => {
  try {
    const { orgBillingId } = c.req.param();
    const marginRate = await dbService.getUsageMarkupForOrg(orgBillingId);

    return c.json({
      orgBillingId,
      marginRate,
      marginPercent: Math.round(marginRate * 100),
    });
  } catch (error) {
    console.error('[Internal Billing] Get markup error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// ORG BILLING LOOKUP — Resolve orgId to orgBillingId
// ============================================

/**
 * GET /internal/billing/org-billing/:orgId
 *
 * Resolves an organizationId to its OrganizationBilling record.
 * Used by cloud-api to get orgBillingId before making billing calls.
 */
app.get('/org-billing/:orgId', async (c) => {
  try {
    const { orgId } = c.req.param();
    const orgBilling = await dbService.getOrganizationBillingByOrgId(orgId);

    if (!orgBilling) {
      return c.json({ error: 'Organization billing not found' }, 404);
    }

    return c.json({
      orgBillingId: orgBilling.id,
      organizationId: orgId,
      stripeCustomerId: orgBilling.stripe_customer_id,
      trialEndsAt: orgBilling.trial_ends_at,
      trialConverted: orgBilling.trial_converted,
    });
  } catch (error) {
    console.error('[Internal Billing] Org billing lookup error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// NOTIFY — Send low-balance or pause emails
// ============================================

/**
 * POST /internal/billing/notify
 *
 * Sends billing notification emails (low balance, deployment pause, etc.)
 * Uses the existing Resend-based email service.
 */
app.post('/notify', async (c) => {
  try {
    const body = await c.req.json();
    const data = notifySchema.parse(body);

    // Idempotency dedupe. Insert the log row first; on UNIQUE collision
    // (P2002 on `idempotency_key`) treat as "already sent" and skip the
    // Resend call. We resolve `orgBillingId` lazily because the caller
    // only knows `orgId`; failing the lookup is non-fatal — it just
    // leaves the log row with `orgBillingId=null`.
    let resolvedOrgBillingId: string | null = null;
    if (data.idempotencyKey) {
      try {
        const orgBilling = await dbService.getOrganizationBillingByOrgId(data.orgId);
        resolvedOrgBillingId = orgBilling?.id ?? null;
      } catch {
        /* swallow — best-effort lookup */
      }

      try {
        await dbService.prismaClient.organizationNotificationLog.create({
          data: {
            idempotencyKey: data.idempotencyKey,
            orgBillingId: resolvedOrgBillingId,
            type: data.type,
            recipientEmail: data.email || null,
            metadata: {
              orgId: data.orgId,
              orgName: data.orgName,
              balanceCents: data.balanceCents,
              dailyCostCents: data.dailyCostCents,
              pausedServicesCount: data.pausedServices?.length ?? 0,
            } as object,
          },
        });
      } catch (err) {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002'
        ) {
          console.info(
            `[Internal Billing] notify dedupe hit type=${data.type} orgId=${data.orgId} key=${data.idempotencyKey}`,
          );
          return c.json({ success: true, type: data.type, alreadyProcessed: true });
        }
        throw err;
      }
    }

    const emailService = new EmailService();

    const balanceStr = data.balanceCents != null
      ? `$${(data.balanceCents / 100).toFixed(2)}`
      : 'unknown';
    const dailyCostStr = data.dailyCostCents != null
      ? `$${(data.dailyCostCents / 100).toFixed(2)}`
      : 'unknown';

    let subject: string;
    let htmlBody: string;

    switch (data.type) {
      case 'low_balance_pause':
        subject = `[Alternate Clouds] Deployments paused — insufficient balance`;
        htmlBody = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Deployments Paused</h2>
            <p>Your compute balance (${balanceStr}) has dropped below the minimum required
            for 1 day of active deployments (${dailyCostStr}/day).</p>
            ${data.pausedServices?.length ? `
              <p><strong>Paused services:</strong></p>
              <ul>${data.pausedServices.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
            ` : ''}
            <p>To resume your deployments, add funds to your compute wallet:</p>
            <a href="https://app.alternatefutures.ai/org/${data.orgId}/billing"
               style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0;">
              Add Funds
            </a>
            <p style="color: #6b7280; font-size: 14px;">
              Once your balance covers at least 1 day of compute costs, your deployments
              will automatically resume.
            </p>
          </div>
        `;
        break;

      case 'low_balance_warning':
        subject = `[Alternate Clouds] Low balance warning — ${balanceStr} remaining`;
        htmlBody = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #f59e0b;">Low Balance Warning</h2>
            <p>Your compute balance is ${balanceStr}. At your current usage rate
            (${dailyCostStr}/day), your deployments may be paused soon.</p>
            <a href="https://app.alternatefutures.ai/org/${data.orgId}/billing"
               style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0;">
              Add Funds
            </a>
          </div>
        `;
        break;

      case 'escrow_depleted':
        subject = `[Alternate Clouds] Escrow depleted — deployment at risk`;
        htmlBody = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ef4444;">Escrow Depleted</h2>
            <p>The escrow for one of your Akash deployments has been fully consumed.
            If your wallet balance is insufficient to top up the escrow, the deployment
            will be paused.</p>
            <a href="https://app.alternatefutures.ai/org/${data.orgId}/billing"
               style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0;">
              Add Funds
            </a>
          </div>
        `;
        break;
    }

    let recipientEmail = data.email;
    if (!recipientEmail) {
      const orgBilling = await dbService.getOrganizationBillingByOrgId(data.orgId);
      if (orgBilling) {
        const ownerInfo = await dbService.getOrgOwnerEmail(orgBilling.id);
        recipientEmail = ownerInfo?.email;
      }
    }

    if (!recipientEmail) {
      console.warn(`[Internal Billing] No recipient email for notify type=${data.type} orgId=${data.orgId}`);
      return c.json({ success: false, error: 'No recipient email found' }, 400);
    }

    let textBody = htmlBody;
    let prev = '';
    while (prev !== textBody) {
      prev = textBody;
      textBody = textBody.replace(/<[^>]*>/g, '');
    }
    textBody = textBody
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    textBody = textBody.replace(/\s+/g, ' ').trim();

    await emailService.sendEmail({
      to: recipientEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });

    return c.json({ success: true, type: data.type });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: error.issues }, 400);
    }
    console.error('[Internal Billing] Notify error:', error);
    return c.json({ error: 'Failed to send notification' }, 500);
  }
});

// ============================================
// MONTHLY SPEND — Real ledger-based monthly usage
// ============================================

/**
 * GET /internal/billing/org-monthly-spend/:orgId
 *
 * Returns total DEBIT amount from the usage ledger for the current
 * calendar month. Includes all spend: compute, AI inference, etc.
 */
app.get('/org-monthly-spend/:orgId', async (c) => {
  try {
    const { orgId } = c.req.param();
    const spendCents = await dbService.getOrgMonthlySpendCents(orgId);
    return c.json({ orgId, currentMonthCents: spendCents });
  } catch (error) {
    console.error('[Internal Billing] Monthly spend error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ============================================
// SUBSCRIPTION STATUS — For service-cloud-api pre-deploy checks
// ============================================

/**
 * GET /internal/billing/subscription-status/:orgId
 *
 * Returns the org's subscription status so cloud-api can gate
 * deployments for SUSPENDED orgs.
 */
app.get('/subscription-status/:orgId', async (c) => {
  try {
    const { orgId } = c.req.param();
    const status = await dbService.getOrgSubscriptionStatus(orgId);

    if (!status) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    return c.json(status);
  } catch (error) {
    console.error('[Internal Billing] Subscription status error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

export default app;
