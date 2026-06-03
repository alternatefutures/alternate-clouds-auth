/**
 * Organization team invitations + membership mutation funnel.
 *
 * ALL membership add/remove operations go through `attachMember` / `detachMember`
 * here so that per-seat billing (Phase 2 — `syncOrgSeats`) has a single hook point.
 */

import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { dbService } from './db.service';
import { hashToken } from '../utils/crypto';
import { syncOrgSeats } from './seatBilling.service';
import type { OrgRole, InvitationStatus } from '@prisma/client';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Roles that may be assigned via an invitation (never OWNER). */
export type InvitableRole = 'ADMIN' | 'MEMBER';

/** Generate a cryptographically random, URL-safe one-time invite token. */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create (or refresh) a PENDING invitation for an email on an org.
 * Re-inviting the same email reuses the row (new token, reset expiry).
 * Returns the raw token (emailed once) — only the hash is stored.
 */
export async function createOrRefreshInvitation(params: {
  organizationId: string;
  email: string;
  role: InvitableRole;
  invitedByUserId: string;
}): Promise<{ invitationId: string; rawToken: string; email: string }> {
  const prisma = dbService.prismaClient;
  const email = normalizeEmail(params.email);
  const rawToken = generateInviteToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invitation = await prisma.organizationInvitation.upsert({
    where: {
      organizationId_email: { organizationId: params.organizationId, email },
    },
    create: {
      id: nanoid(),
      organizationId: params.organizationId,
      email,
      role: params.role as OrgRole,
      status: 'PENDING',
      tokenHash,
      invitedByUserId: params.invitedByUserId,
      expiresAt,
    },
    update: {
      role: params.role as OrgRole,
      status: 'PENDING',
      tokenHash,
      invitedByUserId: params.invitedByUserId,
      expiresAt,
      acceptedAt: null,
      acceptedByUserId: null,
    },
  });

  return { invitationId: invitation.id, rawToken, email };
}

export async function listPendingInvitations(organizationId: string) {
  const prisma = dbService.prismaClient;
  return prisma.organizationInvitation.findMany({
    where: { organizationId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getInvitationByRawToken(rawToken: string) {
  const prisma = dbService.prismaClient;
  return prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<boolean> {
  const prisma = dbService.prismaClient;
  const invite = await prisma.organizationInvitation.findUnique({ where: { id: invitationId } });
  if (!invite || invite.organizationId !== organizationId) return false;
  await prisma.organizationInvitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED' },
  });
  return true;
}

function isInviteUsable(status: InvitationStatus, expiresAt: Date): boolean {
  return status === 'PENDING' && expiresAt.getTime() > Date.now();
}

/**
 * Add a user to an org as a member (idempotent), then reconcile seat count.
 * This is THE membership-add funnel — keep seat sync here.
 */
export async function attachMember(
  organizationId: string,
  userId: string,
  role: OrgRole,
): Promise<{ created: boolean }> {
  const existing = await dbService.getOrganizationMember(organizationId, userId);
  if (existing) {
    return { created: false };
  }
  await dbService.createOrganizationMember({
    id: nanoid(),
    organization_id: organizationId,
    user_id: userId,
    role,
  });
  await syncOrgSeats(organizationId, { reason: 'member_added' });
  return { created: true };
}

/**
 * Tell service-cloud-api to drop its cached platform `OrganizationMember` row
 * so a removed user loses platform access immediately (the cloud-api auth
 * fast-path trusts the local row and never re-checks auth once it exists).
 * Best-effort: logged on failure, since the auth DB is the source of truth.
 */
async function revokePlatformMembership(organizationId: string, userId: string): Promise<void> {
  const cloudApiUrl = process.env.CLOUD_API_URL;
  const secret = process.env.AUTH_INTROSPECTION_SECRET;
  if (!cloudApiUrl) {
    console.warn('[invites] CLOUD_API_URL not set — skipping platform membership revoke');
    return;
  }
  try {
    const res = await fetch(`${cloudApiUrl}/internal/org/member-removed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-af-introspection-secret': secret } : {}),
      },
      body: JSON.stringify({ organizationId, userId }),
    });
    if (!res.ok) {
      console.error(`[invites] platform membership revoke returned ${res.status} for org ${organizationId} user ${userId}`);
    }
  } catch (err) {
    console.error('[invites] failed to revoke platform membership:', err);
  }
}

/**
 * Remove a user from an org, then reconcile seat count.
 * This is THE membership-remove funnel — keep seat sync here.
 */
export async function detachMember(organizationId: string, userId: string): Promise<void> {
  await dbService.deleteOrganizationMember(organizationId, userId);
  await revokePlatformMembership(organizationId, userId);
  await syncOrgSeats(organizationId, { reason: 'member_removed' });
}

/**
 * Accept a single invitation by its raw token for a known user.
 * Validates token usability + email match. Idempotent if already a member.
 */
export async function acceptInvitationByToken(params: {
  rawToken: string;
  userId: string;
  userEmail: string;
}): Promise<
  | { ok: true; organizationId: string; role: OrgRole }
  | { ok: false; reason: 'not_found' | 'expired' | 'email_mismatch' }
> {
  const prisma = dbService.prismaClient;
  const invite = await getInvitationByRawToken(params.rawToken);

  if (!invite) return { ok: false, reason: 'not_found' };

  // Idempotent: if this same user already accepted (e.g. auto-joined via
  // reconcilePendingInvites on login, then landed on the accept page), treat
  // as success rather than surfacing an "expired" error.
  if (invite.status === 'ACCEPTED' && invite.acceptedByUserId === params.userId) {
    return { ok: true, organizationId: invite.organizationId, role: invite.role };
  }

  if (!isInviteUsable(invite.status, invite.expiresAt)) {
    if (invite.status === 'PENDING' && invite.expiresAt.getTime() <= Date.now()) {
      await prisma.organizationInvitation.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    }
    return { ok: false, reason: 'expired' };
  }
  if (normalizeEmail(params.userEmail) !== invite.email) {
    return { ok: false, reason: 'email_mismatch' };
  }

  await attachMember(invite.organizationId, params.userId, invite.role);
  await prisma.organizationInvitation.update({
    where: { id: invite.id },
    data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: params.userId },
  });

  return { ok: true, organizationId: invite.organizationId, role: invite.role };
}

/**
 * Accept all PENDING, non-expired invitations addressed to `email`.
 * Called at signup/login so an invited user auto-joins their team org(s).
 */
export async function reconcilePendingInvites(userId: string, email: string): Promise<number> {
  const prisma = dbService.prismaClient;
  const normalized = normalizeEmail(email);
  const now = new Date();

  const pending = await prisma.organizationInvitation.findMany({
    where: { email: normalized, status: 'PENDING' },
  });

  let accepted = 0;
  for (const invite of pending) {
    if (invite.expiresAt.getTime() <= now.getTime()) {
      await prisma.organizationInvitation.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
      continue;
    }
    try {
      await attachMember(invite.organizationId, userId, invite.role);
      await prisma.organizationInvitation.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: userId },
      });
      accepted += 1;
    } catch (err) {
      console.error(`reconcilePendingInvites: failed to attach ${userId} to ${invite.organizationId}:`, err);
    }
  }
  return accepted;
}
