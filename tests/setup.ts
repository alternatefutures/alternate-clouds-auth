/**
 * Test setup and utilities
 */

import { beforeEach, afterEach } from 'vitest';
import { dbService } from '../src/services/db.service';

// Setup before each test
beforeEach(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';

  // Use in-memory database for tests
  process.env.DATABASE_URL = ':memory:';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
  process.env.JWT_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  // Reset database to fresh state for each test if the helper exists.
  // The Prisma migration removed `dbService.reset()`; DB-dependent route tests
  // are pre-existing broken (need a separate test-DB fixture). Pure unit tests
  // (services/utils) don't need a DB and should still run.
  const maybeReset = (dbService as unknown as { reset?: (url: string) => void }).reset;
  if (typeof maybeReset === 'function') {
    maybeReset.call(dbService, ':memory:');
  }
});

// Cleanup after each test (optional, but good practice)
afterEach(() => {
  // No need to manually clean up - beforeEach will reset for next test
  // But we can close the connection to free resources
  // Note: Don't close here as the singleton might be used again
});

// Mock fetch for external API calls
global.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;
