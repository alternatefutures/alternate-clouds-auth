/**
 * Discord notifier — pings a webhook when a new user signs up.
 *
 * Wired to a SEPARATE channel from the bug-report / feedback webhook
 * (which lives in service-cloud-api/src/resolvers/feedback.ts) so the
 * support channel doesn't get drowned in signup pings.
 *
 * Contract:
 *   - Reads `DISCORD_SIGNUPS_WEBHOOK_URL`. If unset → no-op (so dev
 *     environments don't need it and a missing prod secret never
 *     blocks a signup).
 *   - Fire-and-forget: the caller already returned a session to the
 *     user; we never throw, never block, never let a Discord outage
 *     surface as a 500.
 *   - 5s timeout on the POST so a hung Discord edge node can't stall
 *     a signup-completion request beyond that.
 *   - Per-process in-memory dedupe by userId so a route retry / a
 *     double-fired audit row can't fire the embed twice.
 */

const WEBHOOK_URL_ENV = 'DISCORD_SIGNUPS_WEBHOOK_URL';
const WEBHOOK_TIMEOUT_MS = 5_000;
const SIGNUP_DEDUPE_TTL_MS = 60 * 60 * 1000;
const DISCORD_COLOR_SIGNUP = 0x22c55e;
// Amber for whitelist requests so the embed visually reads as
// "needs your attention" — same convention as bug/feature reports
// (red/blue/purple) in service-cloud-api/src/resolvers/feedback.ts.
const DISCORD_COLOR_WHITELIST_REQUEST = 0xf59e0b;

const dedupeFiredAt = new Map<string, number>();

export interface NewSignupNotification {
  userId: string;
  /** Full email if the signup method captured one (oauth/email). */
  email?: string | null;
  /**
   * Human-readable identifier shown when no email is present
   * (e.g. shortened wallet address, last-4 of phone).
   */
  identifier?: string | null;
  /** Friendly label: "Google OAuth", "Email Magic Link", "SMS", "Wallet (SIWE)", etc. */
  method: string;
  createdAt: Date;
}

export async function notifyNewSignup(
  signup: NewSignupNotification,
): Promise<void> {
  const webhookUrl = process.env[WEBHOOK_URL_ENV];
  if (!webhookUrl) return;

  const now = Date.now();
  const last = dedupeFiredAt.get(signup.userId);
  if (last !== undefined && now - last < SIGNUP_DEDUPE_TTL_MS) return;
  dedupeFiredAt.set(signup.userId, now);

  pruneDedupe(now);

  const fields = [
    {
      name: 'Email',
      value: signup.email && signup.email.trim().length > 0
        ? signup.email
        : signup.identifier ?? '(none)',
      inline: true,
    },
    { name: 'Method', value: signup.method, inline: true },
    {
      name: 'Date',
      value: signup.createdAt.toISOString(),
      inline: true,
    },
    { name: 'User ID', value: signup.userId, inline: false },
  ];

  const embed = {
    title: '👋 New signup',
    color: DISCORD_COLOR_SIGNUP,
    fields,
    timestamp: signup.createdAt.toISOString(),
    footer: {
      text: `service-auth · ${process.env.NODE_ENV ?? 'unknown'}`,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[discord-notifier] webhook returned ${res.status} for signup ${signup.userId}`,
      );
    }
  } catch (err) {
    console.warn(
      `[discord-notifier] webhook failed for signup ${signup.userId}:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface WhitelistRequestNotification {
  email: string;
  identifier: string;
  identifierType: string;
  name: string;
  reason: string;
  ipAddress?: string | null;
  createdAt: Date;
}

/**
 * Ping Discord when a user submits a whitelist (early-access) request.
 * Reuses the SIGNUPS webhook intentionally (same channel, distinct
 * styling) — admin asked for visually-different messages, not a
 * second channel. Amber + 🚪 distinguishes "needs review" from the
 * green "👋 New signup" embeds.
 */
export async function notifyWhitelistRequest(
  request: WhitelistRequestNotification,
): Promise<void> {
  const webhookUrl = process.env[WEBHOOK_URL_ENV];
  if (!webhookUrl) return;

  // Truncate generous but bounded; Discord embed field cap is 1024.
  const truncatedReason =
    request.reason.length > 1000
      ? request.reason.slice(0, 997) + '...'
      : request.reason;

  const fields = [
    { name: 'Name', value: request.name || '(none)', inline: true },
    { name: 'Contact email', value: request.email, inline: true },
    { name: 'Identifier', value: `${request.identifierType}: ${request.identifier}`, inline: false },
    {
      name: 'Date',
      value: request.createdAt.toISOString(),
      inline: true,
    },
    {
      name: 'What they want to build',
      value: truncatedReason || '(none)',
      inline: false,
    },
  ];

  if (request.ipAddress) {
    fields.push({ name: 'IP', value: request.ipAddress, inline: true });
  }

  const embed = {
    title: '🚪 Access request',
    color: DISCORD_COLOR_WHITELIST_REQUEST,
    fields,
    timestamp: request.createdAt.toISOString(),
    footer: {
      text: `service-auth · whitelist request · ${process.env.NODE_ENV ?? 'unknown'}`,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(
        `[discord-notifier] whitelist webhook returned ${res.status} for ${request.email}`,
      );
    }
  } catch (err) {
    console.warn(
      `[discord-notifier] whitelist webhook failed for ${request.email}:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timer);
  }
}

function pruneDedupe(now: number): void {
  // O(n) but n is bounded by signups-per-hour — fine for the worst
  // realistic case (thousands at most). Prevents unbounded growth.
  for (const [userId, firedAt] of dedupeFiredAt) {
    if (now - firedAt >= SIGNUP_DEDUPE_TTL_MS) dedupeFiredAt.delete(userId);
  }
}

/** Test helper — clears the dedupe cache between tests. */
export function __resetDiscordNotifierDedupeForTesting(): void {
  dedupeFiredAt.clear();
}
