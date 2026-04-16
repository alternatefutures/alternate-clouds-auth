import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getReplayedRefreshResponse,
  rememberRefreshResponse,
  __resetRefreshReplayCacheForTesting,
  __getRefreshReplayCacheSizeForTesting,
} from '../../src/services/refreshReplayCache';

describe('refreshReplayCache', () => {
  beforeEach(() => {
    __resetRefreshReplayCacheForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when the token has never been seen', () => {
    expect(getReplayedRefreshResponse('never-seen')).toBeNull();
  });

  it('returns the cached response for the same presented token within the window', () => {
    const body = { success: true, accessToken: 'a1', refreshToken: 'r1', user: { id: 'u' } };
    rememberRefreshResponse('old-token', body);

    const replayed = getReplayedRefreshResponse('old-token');
    expect(replayed).toEqual(body);
  });

  it('returns null after the retention window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T00:00:00Z'));

    rememberRefreshResponse('old-token', { accessToken: 'a' });
    expect(getReplayedRefreshResponse('old-token')).toBeTruthy();

    vi.advanceTimersByTime(15_001);

    expect(getReplayedRefreshResponse('old-token')).toBeNull();
  });

  it('does not leak across different presented tokens (keys are isolated by hash)', () => {
    rememberRefreshResponse('token-A', { accessToken: 'a-for-A' });
    rememberRefreshResponse('token-B', { accessToken: 'a-for-B' });

    expect(getReplayedRefreshResponse('token-A')).toEqual({ accessToken: 'a-for-A' });
    expect(getReplayedRefreshResponse('token-B')).toEqual({ accessToken: 'a-for-B' });
    expect(getReplayedRefreshResponse('token-C')).toBeNull();
  });

  it('overwrites a previous entry if the same token is remembered twice', () => {
    rememberRefreshResponse('t', { accessToken: 'first' });
    rememberRefreshResponse('t', { accessToken: 'second' });
    expect(getReplayedRefreshResponse('t')).toEqual({ accessToken: 'second' });
  });

  it('handles N concurrent callers presenting the same old token (the actual bug we shipped this for)', () => {
    // Simulates 10 polling hooks all racing /auth/refresh after access-token
    // expiry. The first call rotates and remembers; the rest must all see the
    // same cached response instead of triggering reuse detection.
    const rotated = {
      success: true,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: { id: 'u-1' },
    };
    rememberRefreshResponse('stale-token', rotated);

    const responses = Array.from({ length: 10 }, () =>
      getReplayedRefreshResponse('stale-token')
    );
    for (const r of responses) {
      expect(r).toEqual(rotated);
    }
  });

  it('lazily evicts expired entries on read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T00:00:00Z'));

    rememberRefreshResponse('t1', { v: 1 });
    expect(__getRefreshReplayCacheSizeForTesting()).toBe(1);

    vi.advanceTimersByTime(15_001);

    expect(getReplayedRefreshResponse('t1')).toBeNull();
    expect(__getRefreshReplayCacheSizeForTesting()).toBe(0);
  });

  it('evicts expired entries when a new entry is inserted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T00:00:00Z'));

    rememberRefreshResponse('old', { v: 1 });
    expect(__getRefreshReplayCacheSizeForTesting()).toBe(1);

    vi.advanceTimersByTime(15_001);

    rememberRefreshResponse('new', { v: 2 });
    // The expired 'old' entry should have been swept on insert.
    expect(__getRefreshReplayCacheSizeForTesting()).toBe(1);
    expect(getReplayedRefreshResponse('old')).toBeNull();
    expect(getReplayedRefreshResponse('new')).toEqual({ v: 2 });
  });

  it('returns null and removes the entry when read after individual expiry (cache miss path)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T00:00:00Z'));

    rememberRefreshResponse('t', { v: 1 });
    vi.advanceTimersByTime(15_001);

    expect(getReplayedRefreshResponse('t')).toBeNull();
    // Explicitly verify the entry was removed even on a read miss.
    expect(__getRefreshReplayCacheSizeForTesting()).toBe(0);
  });
});
