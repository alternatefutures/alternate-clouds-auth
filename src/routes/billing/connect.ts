/**
 * Connect Routes
 * Manage Stripe Connect & Stax Connect accounts (marketplace/platform)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { dbService } from '../../services/db.service';
import { getProvider, isProviderAvailable } from '../../services/payments';

const app = new Hono();

app.use('*', authMiddleware);

const createConnectedAccountSchema = z.object({
  provider: z.enum(['stripe', 'stax']).optional().default('stripe'),
  email: z.string().email(),
  businessName: z.string().min(1).max(255).optional(),
  country: z.string().length(2).optional().default('US'),
  accountType: z.enum(['standard', 'express', 'custom']).optional().default('express'),
});

const onboardingLinkSchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});

const createTransferSchema = z.object({
  connectedAccountId: z.string().min(1),
  amount: z.number().int().min(1),
  currency: z.string().optional().default('usd'),
  description: z.string().optional(),
  sourcePaymentId: z.string().optional(),
});

/**
 * GET /billing/connect/accounts
 * List connected accounts for authenticated user
 */
app.get('/accounts', async (c) => {
  try {
    const user = requireAuthUser(c);

    const accounts = await dbService.listConnectedAccountsByUserId(user.userId);

    return c.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        accountType: a.account_type,
        email: a.email,
        businessName: a.business_name,
        country: a.country,
        chargesEnabled: a.charges_enabled === 1,
        payoutsEnabled: a.payouts_enabled === 1,
        detailsSubmitted: a.details_submitted === 1,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error('List connected accounts error:', error);
    return c.json({ error: 'Failed to list connected accounts' }, 500);
  }
});

/**
 * POST /billing/connect/accounts
 * Create a new connected account
 */
app.post('/accounts', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = createConnectedAccountSchema.parse(body);

    if (!isProviderAvailable(data.provider)) {
      return c.json({ error: `${data.provider} not configured` }, 400);
    }

    // Check if user already has account with this provider
    const existingAccounts = await dbService.listConnectedAccountsByUserId(user.userId);
    const existingAccount = existingAccounts.find(acc => acc.provider === data.provider);
    if (existingAccount) {
      return c.json({ error: `Already have a ${data.provider} connected account` }, 400);
    }

    const provider = getProvider(data.provider);

    if (!provider.createConnectedAccount) {
      return c.json({ error: `${data.provider} does not support connected accounts` }, 400);
    }

    // Create connected account in provider
    const externalAccount = await provider.createConnectedAccount({
      email: data.email,
      businessName: data.businessName,
      country: data.country,
      type: data.accountType,
      metadata: { userId: user.userId },
    });

    // Save to database
    const account = await dbService.createConnectedAccount({
      id: nanoid(),
      user_id: user.userId,
      provider: data.provider,
      account_type: data.accountType,
      stripe_account_id: data.provider === 'stripe' ? externalAccount.id : undefined,
      stax_sub_merchant_id: data.provider === 'stax' ? externalAccount.id : undefined,
      email: data.email,
      business_name: data.businessName,
      country: data.country,
      charges_enabled: externalAccount.chargesEnabled ? 1 : 0,
      payouts_enabled: externalAccount.payoutsEnabled ? 1 : 0,
      details_submitted: externalAccount.detailsSubmitted ? 1 : 0,
    });

    return c.json({
      account: {
        id: account.id,
        provider: account.provider,
        accountType: account.account_type,
        email: account.email,
        businessName: account.business_name,
        country: account.country,
        chargesEnabled: account.charges_enabled === 1,
        payoutsEnabled: account.payouts_enabled === 1,
        detailsSubmitted: account.details_submitted === 1,
        createdAt: account.created_at,
      },
    });
  } catch (error) {
    console.error('Create connected account error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create connected account' }, 500);
  }
});

/**
 * GET /billing/connect/accounts/:id
 * Get a specific connected account
 */
app.get('/accounts/:id', async (c) => {
  try {
    const user = requireAuthUser(c);
    const accountId = c.req.param('id');

    const account = await dbService.getConnectedAccountById(accountId);
    if (!account || account.user_id !== user.userId) {
      return c.json({ error: 'Connected account not found' }, 404);
    }

    // Get latest status from provider
    const provider = getProvider(account.provider);
    const providerAccountId = account.stripe_account_id || account.stax_sub_merchant_id;

    if (provider.getConnectedAccount && providerAccountId) {
      const externalAccount = await provider.getConnectedAccount(providerAccountId);
      if (externalAccount) {
        // Update local record
        await dbService.updateConnectedAccount(account.id, {
          charges_enabled: externalAccount.chargesEnabled ? 1 : 0,
          payouts_enabled: externalAccount.payoutsEnabled ? 1 : 0,
          details_submitted: externalAccount.detailsSubmitted ? 1 : 0,
        });

        return c.json({
          account: {
            id: account.id,
            provider: account.provider,
            accountType: account.account_type,
            email: externalAccount.email || account.email,
            businessName: externalAccount.businessName || account.business_name,
            country: externalAccount.country || account.country,
            chargesEnabled: externalAccount.chargesEnabled,
            payoutsEnabled: externalAccount.payoutsEnabled,
            detailsSubmitted: externalAccount.detailsSubmitted,
            createdAt: account.created_at,
          },
        });
      }
    }

    return c.json({
      account: {
        id: account.id,
        provider: account.provider,
        accountType: account.account_type,
        email: account.email,
        businessName: account.business_name,
        country: account.country,
        chargesEnabled: account.charges_enabled === 1,
        payoutsEnabled: account.payouts_enabled === 1,
        detailsSubmitted: account.details_submitted === 1,
        createdAt: account.created_at,
      },
    });
  } catch (error) {
    console.error('Get connected account error:', error);
    return c.json({ error: 'Failed to get connected account' }, 500);
  }
});

/**
 * POST /billing/connect/accounts/:id/onboarding-link
 * Create an onboarding link for a connected account
 */
app.post('/accounts/:id/onboarding-link', async (c) => {
  try {
    const user = requireAuthUser(c);
    const accountId = c.req.param('id');
    const body = await c.req.json();
    const data = onboardingLinkSchema.parse(body);

    const account = await dbService.getConnectedAccountById(accountId);
    if (!account || account.user_id !== user.userId) {
      return c.json({ error: 'Connected account not found' }, 404);
    }

    const provider = getProvider(account.provider);
    const providerAccountId = account.stripe_account_id || account.stax_sub_merchant_id;

    if (!provider.createAccountOnboardingLink || !providerAccountId) {
      return c.json({ error: 'Onboarding links not supported' }, 400);
    }

    const link = await provider.createAccountOnboardingLink(
      providerAccountId,
      data.returnUrl,
      data.refreshUrl
    );

    return c.json({
      url: link.url,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    console.error('Create onboarding link error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create onboarding link' }, 500);
  }
});

/**
 * POST /billing/connect/accounts/:id/dashboard-link
 * Create a dashboard link for a connected account
 */
app.post('/accounts/:id/dashboard-link', async (c) => {
  try {
    const user = requireAuthUser(c);
    const accountId = c.req.param('id');

    const account = await dbService.getConnectedAccountById(accountId);
    if (!account || account.user_id !== user.userId) {
      return c.json({ error: 'Connected account not found' }, 404);
    }

    const provider = getProvider(account.provider);
    const providerAccountId = account.stripe_account_id || account.stax_sub_merchant_id;

    if (!provider.createAccountDashboardLink || !providerAccountId) {
      return c.json({ error: 'Dashboard links not supported' }, 400);
    }

    const link = await provider.createAccountDashboardLink(providerAccountId);

    return c.json({
      url: link.url,
    });
  } catch (error) {
    console.error('Create dashboard link error:', error);
    return c.json({ error: 'Failed to create dashboard link' }, 500);
  }
});

/**
 * DELETE /billing/connect/accounts/:id
 * Delete a connected account
 */
app.delete('/accounts/:id', async (c) => {
  try {
    const user = requireAuthUser(c);
    const accountId = c.req.param('id');

    const account = await dbService.getConnectedAccountById(accountId);
    if (!account || account.user_id !== user.userId) {
      return c.json({ error: 'Connected account not found' }, 404);
    }

    const provider = getProvider(account.provider);
    const providerAccountId = account.stripe_account_id || account.stax_sub_merchant_id;

    if (provider.deleteConnectedAccount && providerAccountId) {
      await provider.deleteConnectedAccount(providerAccountId);
    }

    await dbService.deleteConnectedAccount(accountId);

    return c.json({ success: true });
  } catch (error) {
    console.error('Delete connected account error:', error);
    return c.json({ error: 'Failed to delete connected account' }, 500);
  }
});

/**
 * POST /billing/connect/transfers
 * Create a transfer to a connected account
 */
app.post('/transfers', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = createTransferSchema.parse(body);

    const account = await dbService.getConnectedAccountById(data.connectedAccountId);
    if (!account || account.user_id !== user.userId) {
      return c.json({ error: 'Connected account not found' }, 404);
    }

    if (!account.payouts_enabled) {
      return c.json({ error: 'Payouts not enabled for this account' }, 400);
    }

    const provider = getProvider(account.provider);
    const providerAccountId = account.stripe_account_id || account.stax_sub_merchant_id;

    if (!provider.createTransfer || !providerAccountId) {
      return c.json({ error: 'Transfers not supported' }, 400);
    }

    // Create transfer in provider
    const externalTransfer = await provider.createTransfer({
      amount: data.amount,
      currency: data.currency,
      destinationAccountId: providerAccountId,
      description: data.description,
      sourceTransaction: data.sourcePaymentId,
      metadata: { userId: user.userId },
    });

    // Save to database
    const transfer = await dbService.createTransfer({
      id: nanoid(),
      connected_account_id: account.id,
      payment_id: data.sourcePaymentId,
      amount: data.amount,
      currency: data.currency,
      status: externalTransfer.status,
      provider: account.provider,
      stripe_transfer_id: account.provider === 'stripe' ? externalTransfer.id : undefined,
      stax_split_id: account.provider === 'stax' ? externalTransfer.id : undefined,
      description: data.description,
    });

    return c.json({
      transfer: {
        id: transfer.id,
        connectedAccountId: transfer.connected_account_id,
        amount: transfer.amount,
        currency: transfer.currency,
        status: transfer.status,
        description: transfer.description,
        createdAt: transfer.created_at,
      },
    });
  } catch (error) {
    console.error('Create transfer error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create transfer' }, 500);
  }
});

/**
 * GET /billing/connect/transfers
 * List transfers for authenticated user's connected accounts
 */
app.get('/transfers', async (c) => {
  try {
    const user = requireAuthUser(c);
    const connectedAccountId = c.req.query('connectedAccountId');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    // Verify ownership if specific account requested
    if (connectedAccountId) {
      const account = await dbService.getConnectedAccountById(connectedAccountId);
      if (!account || account.user_id !== user.userId) {
        return c.json({ error: 'Connected account not found' }, 404);
      }

      const transfers = await dbService.listTransfersByConnectedAccountId(connectedAccountId);

      return c.json({
        transfers: transfers.slice(0, limit).map((t) => ({
          id: t.id,
          connectedAccountId: t.connected_account_id,
          amount: t.amount,
          currency: t.currency,
          status: t.status,
          description: t.description,
          createdAt: t.created_at,
        })),
      });
    }

    // Get all transfers for all user's connected accounts
    const accounts = await dbService.listConnectedAccountsByUserId(user.userId);
    const allTransfers = [];

    for (const account of accounts) {
      const transfers = await dbService.listTransfersByConnectedAccountId(account.id);
      allTransfers.push(...transfers);
    }

    // Sort by created_at desc
    allTransfers.sort((a, b) => b.created_at - a.created_at);

    return c.json({
      transfers: allTransfers.slice(0, limit).map((t) => ({
        id: t.id,
        connectedAccountId: t.connected_account_id,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
        description: t.description,
        createdAt: t.created_at,
      })),
    });
  } catch (error) {
    console.error('List transfers error:', error);
    return c.json({ error: 'Failed to list transfers' }, 500);
  }
});

/**
 * GET /billing/connect/balance
 * Get platform balance — restricted to platform admins only
 */
app.get('/balance', async (c) => {
  try {
    const user = requireAuthUser(c);

    // Platform admin check: user must be OWNER of at least one org
    const orgs = await dbService.getOrganizationsByUserId(user.userId);
    const isAdmin = orgs.some(async (org) => {
      const member = await dbService.getOrganizationMember(org.id, user.userId);
      return member?.role === 'OWNER';
    });

    // Stricter: check synchronously by loading membership for all orgs
    let hasOwnerRole = false;
    for (const org of orgs) {
      const member = await dbService.getOrganizationMember(org.id, user.userId);
      if (member?.role === 'OWNER') {
        hasOwnerRole = true;
        break;
      }
    }

    if (!hasOwnerRole) {
      return c.json({ error: 'Platform admin access required' }, 403);
    }

    if (!isProviderAvailable('stripe')) {
      return c.json({ balances: [] });
    }

    const provider = getProvider('stripe');

    if (!provider.getPlatformBalance) {
      return c.json({ balances: [] });
    }

    const balances = await provider.getPlatformBalance();

    return c.json({ balances });
  } catch (error) {
    console.error('Get platform balance error:', error);
    return c.json({ error: 'Failed to get platform balance' }, 500);
  }
});

export default app;
