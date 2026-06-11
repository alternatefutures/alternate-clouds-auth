# alternate-clouds-auth — Auth + Billing + AI Proxy (service-auth)

Service-level guidance for AI agents. The workspace-level rules in the root
`CLAUDE.md` (one directory up) take precedence — read them first.
Architecture source of truth: `admin/cloud/docs/AF_TECHNICAL_DOCUMENTATION.md`
(§6 service-auth).

## What is this service?

Standalone Hono service on port **1601** providing authentication, billing,
and the AI inference proxy for the AlternateFutures platform.

- User login: email OTP, SMS OTP, EVM wallet (SIWE), OAuth (PKCE)
- JWT sessions (15-min access, 7-day refresh, httpOnly cookies) + Personal Access Tokens (PATs)
- Billing: Stripe (primary), Stax (ACH), Relay (crypto); subscription lifecycle (trial → expiration → grace → suspension → paid); org credit wallet (prepaid USD cents)
- AI inference proxy to 11 providers with per-request cost metering

## Tech stack

- **Runtime**: Node.js (`tsx` for dev, `tsc` for build) — long-running server, NOT edge/serverless
- **Framework**: Hono + `@hono/node-server`
- **Database**: PostgreSQL via Prisma 6 — database `alternatefutures_auth`
- **JWT**: jsonwebtoken · **Wallet auth**: ethers (SIWE) · **Validation**: Zod
- **Email**: Resend (REST API) · **SMS**: Twilio · **Payments**: Stripe / Stax / Relay
- **Secrets**: Infisical (prod) / dotenv (dev)
- **Testing**: Vitest

> **Stale-doc warning:** this service has NOT used SQLite/Turso,
> `better-sqlite3`, or `db/schema.sql` for a long time. The database is
> Prisma + PostgreSQL. `npm run db:setup` and `scripts/setup-db.ts` were
> deleted 2026-06-11 (see `admin/cloud/docs/AF_DELETION_REGISTRY.md`).

## Project structure (verified 2026-06-11)

```
alternate-clouds-auth/
├── src/
│   ├── index.ts             # Entry point (port 1601; mounts /v1 top-level for OpenAI SDK compat)
│   ├── routes/
│   │   ├── auth/            # email, sms, wallet (SIWE), oauth, session, cli, exchange, whitelistRequest
│   │   ├── account/         # profile, methods
│   │   ├── tokens/          # PAT CRUD + internal validate
│   │   ├── billing/         # customer, paymentMethods, subscriptions, invoices, usage,
│   │   │                    #   payments, connect, webhooks, credits, internal (S2S)
│   │   ├── ai/              # Per-provider proxies + v1.ts unified endpoint + _lib/ (cost metering, model registry)
│   │   ├── organizations/   # Org CRUD, members, invitations
│   │   ├── admin/           # Whitelist + user admin (introspection-secret protected)
│   │   └── internal/        # audit, test-only endpoints
│   ├── services/            # jwt, email (Resend), sms (Twilio), oauth, siwe, token,
│   │                        #   payments/ (stripe|stax|relay providers), seatBilling,
│   │                        #   trialScheduler, subscription.guard, whitelist, auditLog,
│   │                        #   secrets (Infisical), rateLimiter, platformSync
│   ├── middleware/          # auth (JWT first, PAT fallback), cors, ratelimit, trace
│   ├── lib/                 # audit, requestContext, discordNotifier
│   └── utils/               # billing, crypto, fingerprint, logger, otp, validators
├── prisma/
│   ├── schema.prisma        # 32 models (AuthUser, AuthMethod, Organization*, Subscription,
│   │                        #   UsageRecord, OrganizationUsageLedger, AuditEvent, …)
│   └── migrations/          # Committed SQL migrations
├── scripts/
│   ├── seed-plans.ts        # Seed subscription plans (MANDATORY after any DB reset)
│   └── normalize-emails.ts
└── tests/
```

## Database — Prisma + PostgreSQL (UNBREAKABLE rules)

- Schema: `prisma/schema.prisma` → database `alternatefutures_auth`. This is a
  separate database and schema from the platform DB (`alternatefutures`, owned
  by `alternate-clouds-api`).
- After ANY schema change: `npx prisma migrate dev --name descriptive_name`
  locally → commit the generated SQL in `prisma/migrations/`.
- CI runs `prisma migrate deploy` on prod deploy. **NEVER `prisma db push` in production.**
- After ANY production reset: seed plans —
  `DATABASE_URL=... npx tsx scripts/seed-plans.ts`. Without it, billing breaks
  silently (NaN charges, no plans).

## API surface (summary)

- `/auth/*` — email/sms request+verify, wallet challenge+verify, OAuth initiate/callback, exchange, refresh, logout, CLI login, public whitelist requests
- `/account/*` — profile, linked auth methods
- `/tokens/*` — PAT create/list/delete, internal validate (`x-af-introspection-secret`)
- `/organizations/*` — org CRUD, members, invitations
- `/billing/*` — customer, payment methods, subscriptions, invoices, usage, payments, Stripe Connect, webhooks, credit wallet
- `/billing/internal/*` — escrow deposit/refund, compute-debit, org-balance/markup/billing, subscription-status — S2S only, protected by `x-af-introspection-secret`, called only by service-cloud-api
- `/admin/*` — whitelist + user admin (introspection secret; consumed by `alternate-clouds-admin`)
- `/ai/{provider}/*` + `/v1/chat/completions` — AI proxy (JWT or PAT + `X-Organization-Id`); usage metered and debited from the org wallet; all debits use idempotency keys

Full route list: `AF_TECHNICAL_DOCUMENTATION.md` §6.

## Development

```bash
pnpm install
cp .env.example .env       # fill in keys
pnpm dev                   # tsx watch, port 1601
pnpm test                  # vitest
pnpm db:migrate            # prisma migrate dev
pnpm db:studio             # Prisma Studio on port 1610
pnpm db:seed               # seed subscription plans
pnpm build && pnpm start   # production build + run
```

## Environment variables (critical)

- `DATABASE_URL` — Postgres connection (`alternatefutures_auth`)
- `JWT_SECRET` — **MUST be identical** to service-cloud-api (`alternate-clouds-api`)
- `AUTH_INTROSPECTION_SECRET` — **MUST be identical** to service-cloud-api
- `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `TWILIO_*`, AI provider keys — see `.env.example`

Local `.env` is dev-only. Production secrets live in K8s Secrets (see
`admin/cloud/docs/AF_DEPLOY_PROTOCOL.md`).

## Deployment

Runs on the AF K3s cluster (namespaces `af-production` / `af-staging`) behind
Traefik; in production it is reached at `auth.alternatefutures.ai` (port 443).
CI: GitHub Actions → GHCR → `kubectl`. Use the `deploy-to-production` skill /
`AF_DEPLOY_PROTOCOL.md` — do not invent a deploy path.

## Related docs

- Root `CLAUDE.md` — workspace rules (handoffs, debug-first, doc review)
- `admin/cloud/docs/AF_TECHNICAL_DOCUMENTATION.md` §6 — full service reference
- `admin/cloud/docs/AF_ACCOUNT_INFRASTRUCTURE.md` — auth, billing, org model
- `admin/cloud/docs/AF_DEVELOPMENT_PROCESS.md` — past incidents (search before debugging)
