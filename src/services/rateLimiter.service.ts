/**
 * Rate Limiter Service
 *
 * Sliding window rate limiting for API operations.
 * Uses Redis when REDIS_URL is set, falls back to in-memory.
 */

interface RateLimitEntry {
  timestamps: number[];
}

interface PenaltyEntry {
  count: number;
  expiresAt: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private penalties: Map<string, PenaltyEntry> = new Map();

  constructor() {
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 60 * 1000);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindow = 24 * 60 * 60 * 1000;
    for (const [key, entry] of this.store.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < maxWindow);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
    for (const [key, penalty] of this.penalties.entries()) {
      if (penalty.expiresAt < now) {
        this.penalties.delete(key);
      }
    }
  }

  async checkLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    let entry = this.store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.store.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Apply progressive penalty
    const penalty = this.penalties.get(key);
    let effectiveLimit = limit;
    if (penalty && penalty.expiresAt > now) {
      const multiplier = Math.min(8, Math.pow(2, penalty.count - 1));
      effectiveLimit = Math.max(1, Math.floor(limit / multiplier));
    }

    if (entry.timestamps.length >= effectiveLimit) {
      const oldest = Math.min(...entry.timestamps);
      const resetAt = new Date(oldest + windowMs);

      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    entry.timestamps.push(now);

    return {
      allowed: true,
      remaining: effectiveLimit - entry.timestamps.length,
      resetAt: new Date(now + windowMs),
    };
  }

  async recordExceeded(key: string, windowSeconds: number): Promise<void> {
    const windowMs = windowSeconds * 1000;
    const existing = this.penalties.get(key);
    const count = existing && existing.expiresAt > Date.now() ? existing.count + 1 : 1;
    this.penalties.set(key, {
      count,
      expiresAt: Date.now() + windowMs * Math.min(8, Math.pow(2, count - 1)),
    });
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
    this.penalties.delete(key);
  }

  async getCount(key: string): Promise<number> {
    const entry = this.store.get(key);
    return entry ? entry.timestamps.length : 0;
  }

  async close(): Promise<void> {
    // No-op for in-memory implementation
  }
}

export const rateLimiter = new RateLimiter();
