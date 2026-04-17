/**
 * Trace middleware (Phase 44 / D2).
 *
 * Runs first on every request so every downstream handler, db call,
 * audit() write, and internal fetch sees the same trace id.
 *
 * Behavior:
 *   1. Read `X-AF-Trace-Id` from the request (case-insensitive). If
 *      absent, mint a fresh uuid. The `X-Request-Id` header is NOT
 *      used as a fallback here — service-auth does not currently
 *      emit log ids and we want traceId to carry one meaning only.
 *   2. Echo the resolved id on the response so the caller can pin
 *      their own logs to our events.
 *   3. Run `next()` inside `requestContext.run({ traceId }, ...)` so
 *      anything awaited from the handler inherits the context via
 *      Node's AsyncLocalStorage.
 *
 * Must be registered BEFORE any route, logger, or middleware that
 * emits audit events — otherwise those events get a mint-on-write
 * uuid instead of the caller's trace id.
 */

import type { MiddlewareHandler } from 'hono'
import { requestContext, resolveTraceId } from '../lib/requestContext'

export const traceMiddleware: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header('x-af-trace-id')
  const traceId = resolveTraceId(incoming)
  c.header('x-af-trace-id', traceId)
  await requestContext.run({ traceId }, async () => {
    await next()
  })
}
