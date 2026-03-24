import { createHash } from 'node:crypto';
import type { Context } from 'hono';

/**
 * Generate a stable device fingerprint from request headers.
 * Uses User-Agent + Accept-Language + a coarse IP prefix (first 3 octets for IPv4,
 * first 3 groups for IPv6) so the fingerprint survives minor IP changes within
 * the same network but differs across devices/browsers.
 */
export function generateDeviceFingerprint(c: Context): string {
  const ua = c.req.header('user-agent') || '';
  const lang = c.req.header('accept-language') || '';
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '';

  const coarseIp = coarsenIp(ip);

  const raw = `${ua}|${lang}|${coarseIp}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
}

function coarsenIp(ip: string): string {
  const first = ip.split(',')[0]?.trim() || '';
  if (first.includes(':')) {
    // IPv6: keep first 3 groups
    return first.split(':').slice(0, 3).join(':');
  }
  // IPv4: keep first 3 octets
  return first.split('.').slice(0, 3).join('.');
}
