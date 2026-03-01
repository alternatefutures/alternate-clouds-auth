/**
 * AI Inference Proxy Routes
 * Proxies requests to AI providers with credit metering
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import openaiRoutes from './openai';
import anthropicRoutes from './anthropic';
import openrouterRoutes from './openrouter';
import groqRoutes from './groq';
import togetherRoutes from './together';
import stabilityRoutes from './stability';
import deepseekRoutes from './deepseek';
import xaiRoutes from './xai';
import worldlabsRoutes from './worldlabs';
import elevenlabsRoutes from './elevenlabs';
import falaiRoutes from './fal-ai';
import v1Routes from './v1';

const app = new Hono();

// Enable CORS for AI routes
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
}));

// Mount provider routes
app.route('/openai', openaiRoutes);
app.route('/anthropic', anthropicRoutes);
app.route('/openrouter', openrouterRoutes);
app.route('/groq', groqRoutes);
app.route('/together', togetherRoutes);
app.route('/stability', stabilityRoutes);
app.route('/deepseek', deepseekRoutes);
app.route('/xai', xaiRoutes);
app.route('/worldlabs', worldlabsRoutes);
app.route('/elevenlabs', elevenlabsRoutes);
app.route('/fal-ai', falaiRoutes);
app.route('/v1', v1Routes);

export default app;
