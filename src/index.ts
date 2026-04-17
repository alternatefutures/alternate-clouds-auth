import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const serviceRoot = path.resolve(path.dirname(__filename), '..');

dotenvConfig({ path: path.join(serviceRoot, '.env') });
dotenvConfig({ path: path.join(serviceRoot, '.env.local'), override: true });
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { corsMiddleware, devCorsMiddleware } from './middleware/cors';
import { traceMiddleware } from './middleware/trace';
import { secretsService } from './services/secrets.service';
import { initializePaymentProviders } from './services/payments';
import { dbService } from './services/db.service';
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import tokensRoutes from './routes/tokens';
import billingRoutes from './routes/billing';
import organizationsRoutes from './routes/organizations';
import aiRoutes from './routes/ai';
import v1Routes from './routes/ai/v1';
import whitelistRoutes from './routes/admin/whitelist';
import adminUsersRoutes from './routes/admin/users';
import testRoutes from './routes/internal/test';
import { startTrialScheduler, stopTrialScheduler } from './services/trialScheduler';

// Initialize secrets before anything else
await secretsService.initialize();

// Initialize payment providers
initializePaymentProviders({
  stripe: process.env.STRIPE_SECRET_KEY ? {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  } : undefined,
  stax: process.env.STAX_API_KEY ? {
    apiKey: process.env.STAX_API_KEY,
    merchantId: process.env.STAX_MERCHANT_ID || '',
    webhookSecret: process.env.STAX_WEBHOOK_SECRET || '',
    sandbox: process.env.STAX_SANDBOX === 'true',
  } : undefined,
  relay: process.env.RELAY_API_KEY ? {
    apiKey: process.env.RELAY_API_KEY,
    webhookSecret: process.env.RELAY_WEBHOOK_SECRET || '',
  } : undefined,
});

const app = new Hono();

// Middleware
// Phase 44/D2: trace middleware runs FIRST so every downstream handler,
// db write, and audit() call sees the same trace id. Order matters:
// putting logger() before this one would give the logger a different id
// from the one we echo to clients and record in audit events.
app.use('*', traceMiddleware);
app.use('*', logger());

// Use appropriate CORS middleware based on environment
const isDevelopment = process.env.NODE_ENV === 'development';
app.use('*', isDevelopment ? devCorsMiddleware : corsMiddleware);

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'alternatefutures-auth',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Database health check — verifies DB connectivity, schema integrity, and seed data
app.get('/health/db', async (c) => {
  const result = await dbService.healthCheck();
  const httpStatus = result.status === 'error' ? 503 : 200;
  return c.json({
    ...result,
    service: 'alternatefutures-auth',
    timestamp: new Date().toISOString(),
  }, httpStatus);
});

// Root endpoint
app.get('/', (c) => {
  return c.json({
    service: 'Alternate Clouds Authentication Service',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      auth: {
        email: {
          request: 'POST /auth/email/request',
          verify: 'POST /auth/email/verify',
        },
        sms: {
          request: 'POST /auth/sms/request',
          verify: 'POST /auth/sms/verify',
        },
        wallet: {
          challenge: 'POST /auth/wallet/challenge',
          verify: 'POST /auth/wallet/verify',
        },
        oauth: {
          initiate: 'GET /auth/oauth/:provider',
          callback: 'GET /auth/oauth/callback',
        },
        session: {
          refresh: 'POST /auth/refresh',
          logout: 'POST /auth/logout',
        },
      },
      account: {
        profile: 'GET /account/profile',
        methods: 'GET /account/methods',
      },
      tokens: {
        create: 'POST /tokens',
        list: 'GET /tokens',
        delete: 'DELETE /tokens/:id',
        validate: 'POST /tokens/validate',
        limits: 'GET /tokens/limits',
      },
      billing: {
        customer: {
          get: 'GET /billing/customer',
          update: 'POST /billing/customer',
        },
        paymentMethods: {
          list: 'GET /billing/payment-methods',
          addCard: 'POST /billing/payment-methods/card',
          addCrypto: 'POST /billing/payment-methods/crypto',
          setDefault: 'PUT /billing/payment-methods/:id/default',
          delete: 'DELETE /billing/payment-methods/:id',
        },
        subscriptions: {
          list: 'GET /billing/subscriptions',
          active: 'GET /billing/subscriptions/active',
          plans: 'GET /billing/subscriptions/plans',
          create: 'POST /billing/subscriptions',
          cancel: 'POST /billing/subscriptions/:id/cancel',
          updateSeats: 'PUT /billing/subscriptions/:id/seats',
        },
        invoices: {
          list: 'GET /billing/invoices',
          get: 'GET /billing/invoices/:id',
          generate: 'POST /billing/invoices/generate',
        },
        usage: {
          current: 'GET /billing/usage/current',
          history: 'GET /billing/usage/history',
          record: 'POST /billing/usage/record',
        },
        payments: {
          list: 'GET /billing/payments',
          process: 'POST /billing/payments',
          createCrypto: 'POST /billing/payments/crypto/create',
          recordCrypto: 'POST /billing/payments/crypto/record',
        },
        connect: {
          listAccounts: 'GET /billing/connect/accounts',
          createAccount: 'POST /billing/connect/accounts',
          getAccount: 'GET /billing/connect/accounts/:id',
          onboardingLink: 'POST /billing/connect/accounts/:id/onboarding-link',
          dashboardLink: 'POST /billing/connect/accounts/:id/dashboard-link',
          deleteAccount: 'DELETE /billing/connect/accounts/:id',
          listTransfers: 'GET /billing/connect/transfers',
          createTransfer: 'POST /billing/connect/transfers',
          platformBalance: 'GET /billing/connect/balance',
        },
        webhooks: {
          stripe: 'POST /billing/webhooks/stripe',
          stax: 'POST /billing/webhooks/stax',
          relay: 'POST /billing/webhooks/relay',
        },
      },
    },
  });
});

// Mount auth routes
app.route('/auth', authRoutes);

// Mount account routes
app.route('/account', accountRoutes);

// Mount tokens routes
app.route('/tokens', tokensRoutes);

// Mount billing routes
app.route('/billing', billingRoutes);

// Mount organizations routes
app.route('/organizations', organizationsRoutes);

// Mount admin routes (protected by introspection secret)
app.route('/admin/whitelist', whitelistRoutes);
app.route('/admin/users', adminUsersRoutes);

// Mount dev/test endpoints (disabled in production inside the route handler)
app.route('/internal/test', testRoutes);

// Mount AI inference proxy routes
app.route('/ai', aiRoutes);

// Mount unified OpenAI-compatible endpoint at top level for SDK compatibility
// Usage: OpenAI(api_key="af_live_xxx", base_url="https://auth.alternatefutures.ai/v1")
app.route('/v1', v1Routes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  const isDev = process.env.NODE_ENV === 'development';
  return c.json(
    {
      error: 'Internal Server Error',
      // Only expose error details in development to prevent information leakage
      ...(isDev ? { message: err.message } : {}),
    },
    500
  );
});

const port = parseInt(process.env.PORT || '1601');

console.log(`🚀 Alternate Clouds Auth Service starting on port ${port}`);

// For edge runtimes (Cloudflare Workers, Bun, Deno)
export default {
  port,
  fetch: app.fetch,
};

// For Node.js development
if (process.env.NODE_ENV !== 'production' || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  const { serve } = await import('@hono/node-server');

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`✅ Server listening on http://localhost:${port}`);
}

// Start trial expiration scheduler (runs in all environments)
startTrialScheduler();

// Graceful shutdown — stop scheduler before process exits
const shutdown = () => {
  console.log('🛑 Shutting down trial scheduler...');
  stopTrialScheduler();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
