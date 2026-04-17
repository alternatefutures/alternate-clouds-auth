/**
 * Audit Log Writer (Phase 44 / D1) — service-auth copy.
 *
 * Identity + billing events land here. An identical helper lives at
 * `service-cloud-api/src/lib/audit.ts` for deployment / health / provider
 * events. The only differences between the two copies:
 *   • `DEFAULT_SOURCE` ("auth" vs "cloud-api")
 *   • traceId fallback (cloud-api reads AsyncLocalStorage requestId;
 *     service-auth mints a fresh uuid until D2 introduces the middleware)
 *   • logging — service-auth uses `console` (no central logger yet)
 *
 * Shape, field names, privacy redaction and null-tolerance are identical
 * so the D3 export cron can UNION both tables without reshaping rows.
 *
 * Contract: fire-and-forget, never throws, never blocks the caller.
 */

import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditStatus = 'ok' | 'warn' | 'error'

export type AuditCategory =
  | 'auth'
  | 'user'
  | 'billing'
  | 'deployment'
  | 'provider'
  | 'health'
  | 'ai-proxy'
  | 'cron'
  | 'system'

export interface AuditEventInput {
  traceId?: string
  source?: string
  category: AuditCategory
  action: string
  status?: AuditStatus

  userId?: string | null
  orgId?: string | null
  projectId?: string | null
  serviceId?: string | null
  deploymentId?: string | null

  durationMs?: number
  payload?: Record<string, unknown>

  errorCode?: string
  errorMessage?: string
}

const DEFAULT_SOURCE = 'auth'

export function audit(prisma: PrismaClient, evt: AuditEventInput): void {
  try {
    const payload = sanitize(evt.payload ?? {}) as Prisma.InputJsonValue
    const data: Prisma.AuditEventUncheckedCreateInput = {
      traceId: evt.traceId ?? randomUUID(),
      source: evt.source ?? DEFAULT_SOURCE,
      category: evt.category,
      action: evt.action,
      status: evt.status ?? 'ok',
      userId: evt.userId ?? null,
      orgId: evt.orgId ?? null,
      projectId: evt.projectId ?? null,
      serviceId: evt.serviceId ?? null,
      deploymentId: evt.deploymentId ?? null,
      durationMs: evt.durationMs,
      payload,
      errorCode: evt.errorCode ?? null,
      errorMessage: evt.errorMessage ? truncate(evt.errorMessage, 2_000) : null,
    }
    prisma.auditEvent
      .create({ data })
      .catch((err) =>
        console.error('[audit] write failed', { action: evt.action, err })
      )
  } catch (err) {
    console.error('[audit] write rejected', { action: evt.action, err })
  }
}

export async function withAudit<T>(
  prisma: PrismaClient,
  base: Omit<
    AuditEventInput,
    'status' | 'durationMs' | 'errorCode' | 'errorMessage'
  >,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now()
  try {
    const result = await fn()
    audit(prisma, { ...base, status: 'ok', durationMs: Date.now() - started })
    return result
  } catch (err) {
    const anyErr = err as { code?: string; message?: string } | undefined
    audit(prisma, {
      ...base,
      status: 'error',
      durationMs: Date.now() - started,
      errorCode: anyErr?.code,
      errorMessage: anyErr?.message ?? String(err),
    })
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Privacy: strip secrets, cap depth, cap length. Must stay in lockstep with
// the cloud-api copy — the export cron assumes both halves apply the same
// redaction rules.
// ────────────────────────────────────────────────────────────────────────────

const SECRET_KEY_RE =
  /^(password|passwd|secret|token|authorization|cookie|set-cookie|private[_-]?key|api[_-]?key|jwt|session|card|cvc|cvv|pan|ssn)$/i

const MAX_STRING_LEN = 4_096
const MAX_DEPTH = 6
const MAX_ARRAY_LEN = 64

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated:depth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncate(value, MAX_STRING_LEN)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, MAX_ARRAY_LEN)
    const out = new Array(limit)
    for (let i = 0; i < limit; i++) out[i] = sanitize(value[i], depth + 1)
    if (value.length > MAX_ARRAY_LEN) out.push(`[truncated:+${value.length - MAX_ARRAY_LEN}]`)
    return out
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '[redacted]'
        continue
      }
      out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  return String(value)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}
