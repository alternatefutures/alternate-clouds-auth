/**
 * Shared billing math helpers.
 *
 * Centralized so the subscribe flow, webhooks, plan-change, seat sync, and the
 * seat preview never drift from each other (a divergence between the *estimate*
 * shown to the user and the *charge* applied would be a billing bug).
 */

export type BillingInterval = 'MONTHLY' | 'YEARLY' | string;

/**
 * The end of one billing period starting at `now` (ms epoch). YEARLY adds a
 * calendar year; everything else (MONTHLY default) adds a calendar month.
 * Returned as a ms epoch timestamp.
 */
export function computePeriodEnd(now: number, billingInterval: BillingInterval): number {
  const end = new Date(now);
  if (billingInterval === 'YEARLY') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end.getTime();
}

/**
 * Day-based proration for the remaining current period (Slack/Stripe-style):
 * `basePricePerSeatCents * seatDelta * (remaining / total)`. For a TRIALING
 * subscription the current period IS the trial window, so this yields the
 * prorated cost of a seat for the trial remainder. `seatDelta` may be negative
 * (the caller decides charge vs credit); the magnitude is what matters.
 */
export function computeProrationCents(
  period: { current_period_start: number; current_period_end: number },
  basePricePerSeatCents: number,
  seatDelta: number,
): number {
  const totalMs = Math.max(1, period.current_period_end - period.current_period_start);
  const remainingMs = Math.max(0, period.current_period_end - Date.now());
  const fractionRemaining = Math.min(1, remainingMs / totalMs);
  return Math.round(basePricePerSeatCents * seatDelta * fractionRemaining);
}
