import { Context, Next } from 'hono';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetAt: number;
  };
}

// In-memory store — rate limits are NOT shared across instances.
// In a multi-instance deployment, each process tracks limits independently.
// TODO: Replace with Redis-backed store for production multi-instance deployments.
if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  console.warn(
    '⚠️  Rate limiting is in-memory only. In a multi-instance deployment, ' +
    'limits will not be shared. Set REDIS_URL to enable distributed rate limiting.'
  );
}
const store: RateLimitStore = {};

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum requests per window
  message?: string; // Custom error message
  keyGenerator?: (c: Context) => string; // Custom key generator
}

/**
 * Rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs = 60000, // Default: 1 minute
    max = 100, // Default: 100 requests per minute
    message = 'Too many requests, please try again later',
    keyGenerator = (c: Context) => {
      // Default: use IP address + endpoint
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      const endpoint = c.req.path;
      return `${ip}:${endpoint}`;
    },
  } = config;

  return async (c: Context, next: Next) => {
    // Skip rate limiting in test environment
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      return next();
    }

    const key = keyGenerator(c);
    const now = Date.now();

    // Clean up expired entries
    if (store[key] && store[key].resetAt < now) {
      delete store[key];
    }

    // Initialize or get existing entry
    if (!store[key]) {
      store[key] = {
        count: 0,
        resetAt: now + windowMs,
      };
    }

    const entry = store[key];

    // Increment count
    entry.count++;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', max.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, max - entry.count).toString());
    c.header('X-RateLimit-Reset', new Date(entry.resetAt).toISOString());

    // Check if limit exceeded
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', retryAfter.toString());

      return c.json(
        {
          error: 'Rate limit exceeded',
          message,
          retryAfter,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Cleanup old entries periodically (call this from a background job)
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  const keys = Object.keys(store);

  for (const key of keys) {
    if (store[key].resetAt < now) {
      delete store[key];
    }
  }

  console.log(`Cleaned up rate limit store. ${keys.length - Object.keys(store).length} entries removed.`);
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}

/**
 * Strict rate limit for sensitive endpoints (login, register)
 */
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: 'Too many authentication attempts, please try again later',
});

/**
 * Standard rate limit for API endpoints
 */
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
});

/**
 * Relaxed rate limit for public endpoints
 */
export const relaxedRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute
});
