/**
 * Per-request storage for service-auth (Phase 44 / D2).
 *
 * Mirrors `service-cloud-api/src/lib/requestContext.ts` in shape so
 * both services agree on what `currentTraceId()` returns. Populated by
 * `src/middleware/trace.ts` at the top of the Hono middleware chain —
 * that middleware reads the inbound `X-AF-Trace-Id` header (or mints
 * one), runs the rest of the request inside `requestContext.run(...)`,
 * and echoes the id on the response so callers can correlate.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

interface RequestStore {
  traceId: string
}

export const requestContext = new AsyncLocalStorage<RequestStore>()

/** Current trace id, or a fresh uuid when called outside a request scope. */
export function currentTraceId(): string {
  return requestContext.getStore()?.traceId ?? randomUUID()
}

/** Resolve trace id from an inbound header value; mint one if absent. */
export function resolveTraceId(headerValue: string | undefined | null): string {
  if (typeof headerValue === 'string' && headerValue.length > 0) return headerValue
  return randomUUID()
}
