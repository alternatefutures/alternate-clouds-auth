import { Hono } from 'hono';
import emailRoutes from './email';
import smsRoutes from './sms';
import walletRoutes from './wallet';
import oauthRoutes from './oauth';
import sessionRoutes from './session';
import exchangeRoutes from './exchange';
import cliRoutes from './cli';
import whitelistRequestRoutes from './whitelistRequest';

const app = new Hono();

// Mount sub-routes
app.route('/email', emailRoutes);
app.route('/sms', smsRoutes);
app.route('/wallet', walletRoutes);
app.route('/oauth', oauthRoutes);
app.route('/whitelist-request', whitelistRequestRoutes);
app.route('/', sessionRoutes);
app.route('/', exchangeRoutes);
app.route('/', cliRoutes);

export default app;
