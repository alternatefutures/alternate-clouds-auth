/**
 * In-memory replay cache for /auth/refresh.
 *
 * Solves the refresh-token rotation race that bounces users out of the app
 * after 15-20 min of idle (the access token TTL). On the first poll after
 * idle, the dashboard fires N parallel API calls, all hit 401, all
 * independently call /auth/refresh with the SAME refresh token. The first
 * one rotates and succeeds. Without this cache, every subsequent caller
 * (presenting the same already-rotated token) trips reuse detection in
 * `routes/auth/session.ts` and the entire token family gets revoked.
 *
 * Behavior: when /auth/refresh successfully rotates a session, we cache the
 * RESPONSE BODY keyed by the SHA-256 hash of the presented (old) refresh
 * token for `RETENTION_MS`. Any subsequent /auth/refresh call within the
 * window that presents the same old token gets served from the cache —
 * same access token, same refresh token, no second rotation, no reuse
 * trigger. After the window expires the entry is evicted and any further
 * use of that old token correctly trips reuse detection.
 *
 * Trade-offs:
 * - Single-process. service-auth runs single-replica today (see
 *   admin/cloud/docs/AF_TECHNICAL_DOCUMENTATION.md). If we ever shard or
 *   horizontally scale, replace this with a Redis-backed implementation
 *   (`SETEX hash:<presentedHash> 15 <responseJson>`).
 * - Memory-bounded by N concurrent races × RETENTION_MS. At 10 sessions/s
 *   peak we cap at ~150 entries; we still LRU-evict at MAX_ENTRIES as a
 *   belt-and-suspenders guard against runaway growth (e.g. an attacker
 *   replaying old tokens to fill the map).
 * - We DO NOT cache failed responses. Only successful rotations.
 *
 * Security: cache key is the SHA-256 of the presented token (matches the
 * scheme used in db.service.ts). Cache value contains the rotated tokens
 * (which are also handed to the legitimate caller via Set-Cookie), so
 * cache compromise is no worse than DB compromise — the attacker would
 * already have the rotated refresh token.
 */

import { createHash } from 'crypto';

const RETENTION_MS = 15_000;
const MAX_ENTRIES = 5000;

interface CachedResponse {
  body: unknown;
  expiresAt: number;
}

const cache = new Map<string, CachedResponse>();

function hashPresentedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function evictExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function evictOldestIfFull(): void {
  if (cache.size < MAX_ENTRIES) return;
  // Map iteration order is insertion order, so the first key is the oldest.
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

/**
 * Look up a cached refresh response for a previously-presented token.
 * Returns the original successful response body if the same token is
 * presented again within RETENTION_MS, otherwise null.
 */
export function getReplayedRefreshResponse(presentedToken: string): unknown | null {
  const now = Date.now();
  const key = hashPresentedToken(presentedToken);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.body;
}

/**
 * Store a successful refresh response under the hash of the token that
 * triggered it. Keep for RETENTION_MS so concurrent callers presenting the
 * same old token get the same already-issued tokens back.
 */
export function rememberRefreshResponse(presentedToken: string, body: unknown): void {
  const now = Date.now();
  evictExpired(now);
  evictOldestIfFull();
  cache.set(hashPresentedToken(presentedToken), {
    body,
    expiresAt: now + RETENTION_MS,
  });
}

/** Test-only helper. Not for production use. */
export function __resetRefreshReplayCacheForTesting(): void {
  cache.clear();
}

/** Test-only inspector. Not for production use. */
export function __getRefreshReplayCacheSizeForTesting(): number {
  return cache.size;
}
