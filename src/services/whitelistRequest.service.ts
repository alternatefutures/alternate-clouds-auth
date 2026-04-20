/**
 * WhitelistRequestService — self-service "let me in" requests.
 *
 * Flow:
 *   1. User hits the early-access gate at /auth/email/request, gets
 *      a 403 from `whitelistService.check403`.
 *   2. The web-app shows a request form. Submit calls the public
 *      route which delegates to `create()` here.
 *   3. We persist a row, return `{ created: true }` (or
 *      `{ alreadyRequested: true }` so the UI can show a friendly
 *      "we have your request" message instead of failing).
 *   4. Admin views pending requests in web-app-admin, calls
 *      `approve()`. That inserts into `auth_whitelist` (so the user
 *      can now sign in) and marks the request APPROVED.
 *   5. The route layer triggers the approval email.
 *
 * Email is `@unique` so the same address can never have two open
 * requests; re-submits are a no-op.
 */

import { PrismaClient, type AuthWhitelistRequest } from '@prisma/client';
import { whitelistService } from './whitelist.service';

const prisma = new PrismaClient();

const NAME_MAX = 120;
const REASON_MAX = 2000;

export type WhitelistRequestCreateResult =
  | { kind: 'created'; request: AuthWhitelistRequest }
  | { kind: 'already_requested'; request: AuthWhitelistRequest }
  | { kind: 'already_whitelisted' };

class WhitelistRequestService {
  /**
   * Submit a new access request. Idempotent: if the email already
   * has a pending or reviewed request, returns the existing row
   * instead of creating a duplicate.
   *
   * Caller is responsible for sending the confirmation email and
   * Discord ping ONLY when `kind === 'created'`.
   */
  async create(input: {
    email: string;
    name: string;
    reason: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<WhitelistRequestCreateResult> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim().slice(0, NAME_MAX);
    const reason = input.reason.trim().slice(0, REASON_MAX);

    // If they're already on the whitelist there's nothing to request.
    if (await whitelistService.isWhitelisted(email)) {
      return { kind: 'already_whitelisted' };
    }

    const existing = await prisma.authWhitelistRequest.findUnique({
      where: { email },
    });
    if (existing) {
      return { kind: 'already_requested', request: existing };
    }

    const request = await prisma.authWhitelistRequest.create({
      data: {
        email,
        name,
        reason,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
    return { kind: 'created', request };
  }

  /** Admin list, newest first. PENDING are surfaced before reviewed. */
  async list(filter?: { status?: 'PENDING' | 'APPROVED' | 'DECLINED' }) {
    return prisma.authWhitelistRequest.findMany({
      where: filter?.status ? { status: filter.status } : undefined,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string) {
    return prisma.authWhitelistRequest.findUnique({ where: { id } });
  }

  /**
   * Approve a request: insert into AuthWhitelist and flip status.
   * Idempotent — re-approving a row is safe (whitelist upserts).
   */
  async approve(id: string, reviewedBy?: string) {
    const request = await prisma.authWhitelistRequest.findUnique({ where: { id } });
    if (!request) return null;

    await whitelistService.add(request.email, 'email', `Approved request ${request.id}`);

    return prisma.authWhitelistRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedBy: reviewedBy ?? null,
      },
    });
  }

  async decline(id: string, reviewedBy?: string) {
    const request = await prisma.authWhitelistRequest.findUnique({ where: { id } });
    if (!request) return null;

    return prisma.authWhitelistRequest.update({
      where: { id },
      data: {
        status: 'DECLINED',
        reviewedAt: new Date(),
        reviewedBy: reviewedBy ?? null,
      },
    });
  }

  async counts(): Promise<{ pending: number; approved: number; declined: number; total: number }> {
    const grouped = await prisma.authWhitelistRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    let pending = 0;
    let approved = 0;
    let declined = 0;
    for (const row of grouped) {
      if (row.status === 'PENDING') pending = row._count._all;
      else if (row.status === 'APPROVED') approved = row._count._all;
      else if (row.status === 'DECLINED') declined = row._count._all;
    }
    return { pending, approved, declined, total: pending + approved + declined };
  }
}

export const whitelistRequestService = new WhitelistRequestService();
