import { Context, Next } from 'hono';

// ============================================
// RATE LIMIT STORE ABSTRACTION
// ============================================

interface RateLimitResult {
  count: number;
  resetAt: number;
}

interface RateLimitStoreBackend {
  increment(key: string, windowMs: number): Promise<RateLimitResult>;
  getPenaltyMultiplier(key: string): Promise<number>;
  recordPenalty(key: string, windowMs: number): Promise<void>;
}

// ============================================
// IN-MEMORY SLIDING WINDOW STORE
// ============================================

class InMemorySlidingWindowStore implements RateLimitStoreBackend {
  private windows: Map<string, number[]> = new Map();
  private penalties: Map<string, { count: number; expiresAt: number }> = new Map();

  constructor() {
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 60 * 1000);
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.windows.get(key) ?? [];
    timestamps = timestamps.filter((ts) => ts > windowStart);
    timestamps.push(now);
    this.windows.set(key, timestamps);

    return {
      count: timestamps.length,
      resetAt: now + windowMs,
    };
  }

  async getPenaltyMultiplier(key: string): Promise<number> {
    const penalty = this.penalties.get(key);
    if (!penalty || penalty.expiresAt < Date.now()) {
      return 1;
    }
    return Math.min(8, Math.pow(2, penalty.count - 1));
  }

  async recordPenalty(key: string, windowMs: number): Promise<void> {
    const existing = this.penalties.get(key);
    const count = existing && existing.expiresAt > Date.now() ? existing.count + 1 : 1;
    this.penalties.set(key, {
      count,
      expiresAt: Date.now() + windowMs * Math.min(8, Math.pow(2, count - 1)),
    });
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindow = 24 * 60 * 60 * 1000;

    for (const [key, timestamps] of this.windows.entries()) {
      const filtered = timestamps.filter((ts) => now - ts < maxWindow);
      if (filtered.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, filtered);
      }
    }

    for (const [key, penalty] of this.penalties.entries()) {
      if (penalty.expiresAt < now) {
        this.penalties.delete(key);
      }
    }
  }
}

// ============================================
// REDIS SLIDING WINDOW STORE
// ============================================

let redisStore: RateLimitStoreBackend | null = null;

async function createRedisStore(redisUrl: string): Promise<RateLimitStoreBackend | null> {
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: redisUrl });
    
    client.on('error', (err) => {
      console.error('[RateLimit] Redis error:', err.message);
    });

    await client.connect();
    console.log('[RateLimit] Redis-backed rate limiting active');

    return {
      async increment(key: string, windowMs: number): Promise<RateLimitResult> {
        const now = Date.now();
        const windowStart = now - windowMs;
        const redisKey = `rl:${key}`;

        const multi = client.multi();
        multi.zRemRangeByScore(redisKey, '-inf', windowStart.toString());
        multi.zAdd(redisKey, { score: now, value: `${now}:${Math.random().toString(36).slice(2)}` });
        multi.zCard(redisKey);
        multi.pExpire(redisKey, windowMs);

        const results = await multi.exec();
        const count = (results?.[2] as number) ?? 1;

        return { count, resetAt: now + windowMs };
      },

      async getPenaltyMultiplier(key: string): Promise<number> {
        const penaltyKey = `rl:penalty:${key}`;
        const val = await client.get(penaltyKey);
        if (!val) return 1;
        const count = parseInt(val, 10);
        return Math.min(8, Math.pow(2, count - 1));
      },

      async recordPenalty(key: string, windowMs: number): Promise<void> {
        const penaltyKey = `rl:penalty:${key}`;
        const current = await client.incr(penaltyKey);
        const ttlMs = windowMs * Math.min(8, Math.pow(2, current - 1));
        await client.pExpire(penaltyKey, ttlMs);
      },
    };
  } catch (err) {
    console.warn('[RateLimit] Redis unavailable, using in-memory fallback:', (err as Error).message);
    return null;
  }
}

// ============================================
// STORE INITIALIZATION
// ============================================

const memoryStore = new InMemorySlidingWindowStore();

async function getStore(): Promise<RateLimitStoreBackend> {
  if (redisStore) return redisStore;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && !redisStore) {
    redisStore = await createRedisStore(redisUrl);
    if (redisStore) return redisStore;
  }

  return memoryStore;
}

if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
  console.warn(
    '[RateLimit] In-memory rate limiting only. In a multi-instance deployment, ' +
    'limits are not shared. Set REDIS_URL to enable distributed rate limiting.'
  );
}

// Eagerly attempt Redis connection on startup
if (process.env.REDIS_URL) {
  getStore().catch(() => {});
}

// ============================================
// RATE LIMIT CONFIG & MIDDLEWARE
// ============================================

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (c: Context) => string;
  progressivePenalties?: boolean;
}

export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs = 60000,
    max = 100,
    message = 'Too many requests, please try again later',
    keyGenerator = (c: Context) => {
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      const endpoint = c.req.path;
      return `${ip}:${endpoint}`;
    },
    progressivePenalties = false,
  } = config;

  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      return next();
    }

    const key = keyGenerator(c);
    const store = await getStore();

    let effectiveMax = max;
    if (progressivePenalties) {
      const multiplier = await store.getPenaltyMultiplier(key);
      if (multiplier > 1) {
        effectiveMax = Math.max(1, Math.floor(max / multiplier));
      }
    }

    const result = await store.increment(key, windowMs);

    c.header('X-RateLimit-Limit', effectiveMax.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, effectiveMax - result.count).toString());
    c.header('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

    if (result.count > effectiveMax) {
      if (progressivePenalties) {
        await store.recordPenalty(key, windowMs);
      }

      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
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

// ============================================
// PRESETS
// ============================================

/**
 * Strict: sensitive auth endpoints (login, register).
 * 5 attempts per 15 minutes, progressive penalties.
 */
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again later',
  progressivePenalties: true,
});

/**
 * Standard: general API endpoints.
 * 60 requests per minute.
 */
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});

/**
 * Relaxed: public/read endpoints.
 * 200 requests per minute.
 */
export const relaxedRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
});

/**
 * AI proxy: higher throughput for inference routes.
 * 120 requests per minute per user.
 */
export const aiProxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (c: Context) => {
    const userId = c.get('userId') || c.req.header('x-forwarded-for') || 'unknown';
    return `ai:${userId}`;
  },
});
