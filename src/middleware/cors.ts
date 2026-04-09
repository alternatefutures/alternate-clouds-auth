/**
 * CORS middleware for handling cross-origin requests
 */

import { cors } from 'hono/cors';

/**
 * CORS configuration for production
 * Allows requests from Alternate Clouds frontend domains
 */
export const corsMiddleware = cors({
  origin: (origin) => {
    // Allow requests from Alternate Clouds domains
    const allowedOrigins = [
      'https://alternatefutures.ai',
      'https://www.alternatefutures.ai',
      'https://app.alternatefutures.ai',
      process.env.FRONTEND_URL || 'http://localhost:5173', // SvelteKit dev server
    ];

    // Allow if origin is in the allowed list
    if (allowedOrigins.includes(origin)) {
      return origin;
    }

    // For development, allow localhost on any port
    if (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost')) {
      return origin;
    }

    // Deny other origins
    return allowedOrigins[0];
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  credentials: true,
  maxAge: 86400, // 24 hours
});

/**
 * Permissive CORS for development (allows all origins)
 * Use only in local development
 */
export const devCorsMiddleware = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
});
