/**
 * Billing Routes
 * Main router for all billing-related endpoints
 */

import { Hono } from 'hono';
import customerRoutes from './customer';
import paymentMethodsRoutes from './paymentMethods';
import subscriptionsRoutes from './subscriptions';
import invoicesRoutes from './invoices';
import usageRoutes from './usage';
import paymentsRoutes from './payments';
import webhooksRoutes from './webhooks';
import connectRoutes from './connect';
import creditsRoutes from './credits';

const app = new Hono();

// Mount all billing sub-routes
app.route('/customer', customerRoutes);
app.route('/payment-methods', paymentMethodsRoutes);
app.route('/subscriptions', subscriptionsRoutes);
app.route('/invoices', invoicesRoutes);
app.route('/usage', usageRoutes);
app.route('/payments', paymentsRoutes);
app.route('/webhooks', webhooksRoutes);
app.route('/connect', connectRoutes);
app.route('/credits', creditsRoutes);

export default app;
