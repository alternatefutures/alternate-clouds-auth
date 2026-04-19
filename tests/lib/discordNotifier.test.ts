import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetDiscordNotifierDedupeForTesting,
  notifyNewSignup,
} from '../../src/lib/discordNotifier';

const ORIGINAL_FETCH = global.fetch;
const WEBHOOK_URL = 'https://discord.example/webhooks/signups';

beforeEach(() => {
  __resetDiscordNotifierDedupeForTesting();
  delete process.env.DISCORD_SIGNUPS_WEBHOOK_URL;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockFetchOk() {
  // Use 200 not 204 — the Web `Response` constructor rejects 204/205/304
  // with a non-null body (TypeError "Invalid response status code 204"),
  // and Discord webhooks return 204 in production but the body is empty;
  // we don't care about the status semantics here, only that res.ok is true.
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200 }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('notifyNewSignup', () => {
  it('is a no-op when DISCORD_SIGNUPS_WEBHOOK_URL is unset', async () => {
    const fetchMock = mockFetchOk();

    await notifyNewSignup({
      userId: 'user-1',
      email: 'alice@example.com',
      method: 'Email Magic Link',
      createdAt: new Date('2026-04-20T10:00:00Z'),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs an embed with email, method, date, and user id when configured', async () => {
    process.env.DISCORD_SIGNUPS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockFetchOk();
    const createdAt = new Date('2026-04-20T10:00:00Z');

    await notifyNewSignup({
      userId: 'user-1',
      email: 'alice@example.com',
      identifier: 'alice@example.com',
      method: 'Email Magic Link',
      createdAt,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fieldByName = Object.fromEntries(
      body.embeds[0].fields.map((f) => [f.name, f.value]),
    );
    expect(fieldByName).toMatchObject({
      Email: 'alice@example.com',
      Method: 'Email Magic Link',
      Date: createdAt.toISOString(),
      'User ID': 'user-1',
    });
  });

  it('falls back to identifier in the Email field for wallet/sms signups (no email captured)', async () => {
    process.env.DISCORD_SIGNUPS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockFetchOk();

    await notifyNewSignup({
      userId: 'user-2',
      email: null,
      identifier: '0xabc...def',
      method: 'Wallet (SIWE)',
      createdAt: new Date('2026-04-20T10:00:00Z'),
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const emailField = body.embeds[0].fields.find(
      (f: { name: string }) => f.name === 'Email',
    );
    expect(emailField.value).toBe('0xabc...def');
  });

  it('dedupes a duplicate notification for the same user within the TTL window', async () => {
    process.env.DISCORD_SIGNUPS_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = mockFetchOk();

    const base = {
      userId: 'user-3',
      email: 'bob@example.com',
      method: 'Google OAuth',
      createdAt: new Date(),
    };

    await notifyNewSignup(base);
    await notifyNewSignup(base);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws when fetch rejects (signup must not fail because Discord is down)', async () => {
    process.env.DISCORD_SIGNUPS_WEBHOOK_URL = WEBHOOK_URL;
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('discord edge unreachable')) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      notifyNewSignup({
        userId: 'user-4',
        email: 'carol@example.com',
        method: 'Email Magic Link',
        createdAt: new Date(),
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('logs a warning on non-2xx but still resolves', async () => {
    process.env.DISCORD_SIGNUPS_WEBHOOK_URL = WEBHOOK_URL;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 500 }),
    ) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await notifyNewSignup({
      userId: 'user-5',
      email: 'dave@example.com',
      method: 'Email Magic Link',
      createdAt: new Date(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('webhook returned 500'),
    );
    warnSpy.mockRestore();
  });
});
