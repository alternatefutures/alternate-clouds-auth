import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';
import { emailService } from '../../services/email.service';
import {
  createOrRefreshInvitation,
  listPendingInvitations,
  revokeInvitation,
  acceptInvitationByToken,
  getInvitationByRawToken,
  detachMember,
  updateMemberScope,
} from '../../services/invites.service';
import { canOrgInviteMembers } from '../../services/seatBilling.service';

const app = new Hono();

const APP_URL = process.env.APP_URL || 'https://app.alternatefutures.ai';

// All routes require authentication
app.use('*', authMiddleware);

/** Resolve the caller's membership + require OWNER/ADMIN. Returns the member or an error tuple. */
async function requireOrgAdmin(orgId: string, userId: string) {
  const member = await dbService.getOrganizationMember(orgId, userId);
  if (!member) {
    return { error: 'Organization not found or access denied', status: 404 as const };
  }
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    return { error: 'Insufficient permissions. OWNER or ADMIN role required.', status: 403 as const };
  }
  return { member };
}

/**
 * GET /organizations
 * List organizations the current user is a member of
 */
app.get('/', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);

    const organizations = await dbService.getOrganizationsByUserId(authUser.userId);

    return c.json({
      organizations: organizations.map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        avatarUrl: org.avatar_url,
        role: org.role,
        createdAt: new Date(org.created_at).toISOString(),
      })),
    });
  } catch (error) {
    console.error('List organizations error:', error);
    return c.json({ error: 'Failed to list organizations' }, 500);
  }
});

/**
 * GET /organizations/:id
 * Get organization by ID (if user is member)
 */
app.get('/:id', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    // Check if user is member
    const isMember = await dbService.isUserMemberOfOrganization(authUser.userId, orgId);

    if (!isMember) {
      return c.json({ error: 'Organization not found or access denied' }, 404);
    }

    const organization = await dbService.getOrganizationById(orgId);

    if (!organization) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    // Get user's role in this org
    const member = await dbService.getOrganizationMember(orgId, authUser.userId);

    return c.json({
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        avatarUrl: organization.avatar_url,
        role: member?.role,
        createdAt: new Date(organization.created_at).toISOString(),
        updatedAt: new Date(organization.updated_at).toISOString(),
      },
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return c.json({ error: 'Failed to get organization' }, 500);
  }
});

// Schema for updating organization
const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

/**
 * PATCH /organizations/:id
 * Update organization (OWNER or ADMIN only)
 */
app.patch('/:id', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    // Check if user is member with sufficient permissions
    const member = await dbService.getOrganizationMember(orgId, authUser.userId);

    if (!member) {
      return c.json({ error: 'Organization not found or access denied' }, 404);
    }

    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    // Validate request body
    const body = await c.req.json();
    const updates = updateOrgSchema.parse(body);

    // Update organization
    await dbService.updateOrganization(orgId, {
      name: updates.name,
      slug: updates.slug,
      avatar_url: updates.avatarUrl ?? undefined,
    });

    const organization = await dbService.getOrganizationById(orgId);

    return c.json({
      success: true,
      organization: {
        id: organization!.id,
        slug: organization!.slug,
        name: organization!.name,
        avatarUrl: organization!.avatar_url,
        role: member.role,
        updatedAt: new Date(organization!.updated_at).toISOString(),
      },
    });
  } catch (error) {
    console.error('Update organization error:', error);

    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation error',
        details: error.issues,
      }, 400);
    }

    return c.json({ error: 'Failed to update organization' }, 500);
  }
});

/**
 * GET /organizations/:id/members
 * List members of an organization
 */
app.get('/:id/members', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    // Check if user is member
    const isMember = await dbService.isUserMemberOfOrganization(authUser.userId, orgId);

    if (!isMember) {
      return c.json({ error: 'Organization not found or access denied' }, 404);
    }

    const members = await dbService.getOrganizationMembers(orgId);

    // Get user details for each member
    const membersWithUsers = await Promise.all(
      members.map(async (member) => {
        const user = await dbService.getUserById(member.user_id);
        return {
          id: member.id,
          userId: member.user_id,
          role: member.role,
          email: user?.email,
          displayName: user?.display_name,
          avatarUrl: user?.avatar_url,
          joinedAt: new Date(member.created_at).toISOString(),
          accessAllProjects: member.access_all_projects,
          projectIds: member.project_ids,
        };
      })
    );

    return c.json({
      members: membersWithUsers,
    });
  } catch (error) {
    console.error('List organization members error:', error);
    return c.json({ error: 'Failed to list members' }, 500);
  }
});

// ============================================
// MEMBER MANAGEMENT
// ============================================

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER']),
});

/**
 * PATCH /organizations/:id/members/:userId/role
 * Change a member's role (OWNER only). Cannot change the last OWNER.
 */
app.patch('/:id/members/:userId/role', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');
    const targetUserId = c.req.param('userId');

    const caller = await dbService.getOrganizationMember(orgId, authUser.userId);
    if (!caller) {
      return c.json({ error: 'Organization not found or access denied' }, 404);
    }
    if (caller.role !== 'OWNER') {
      return c.json({ error: 'Only the OWNER can change member roles' }, 403);
    }

    const target = await dbService.getOrganizationMember(orgId, targetUserId);
    if (!target) {
      return c.json({ error: 'Member not found' }, 404);
    }

    const { role } = updateRoleSchema.parse(await c.req.json());

    // Guard: never demote the last OWNER.
    if (target.role === 'OWNER') {
      const members = await dbService.getOrganizationMembers(orgId);
      const ownerCount = members.filter((m) => m.role === 'OWNER').length;
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot demote the only OWNER of the organization' }, 400);
      }
    }

    await dbService.updateOrganizationMemberRole(orgId, targetUserId, role);

    // Elevating to ADMIN grants full project access — keep the platform mirror
    // consistent (role here is only ever ADMIN | MEMBER).
    if (role === 'ADMIN') {
      await updateMemberScope(orgId, targetUserId, { accessAllProjects: true, projectIds: [] });
    }
    return c.json({ success: true, userId: targetUserId, role });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    console.error('Update member role error:', error);
    return c.json({ error: 'Failed to update member role' }, 500);
  }
});

const updateAccessSchema = z.object({
  accessAllProjects: z.boolean(),
  projectIds: z.array(z.string()).optional().default([]),
});

/**
 * PATCH /organizations/:id/members/:userId/access
 * Update a member's project-scoped access (OWNER/ADMIN). OWNER/ADMIN members
 * always retain full access — scope only applies to MEMBERs.
 */
app.patch('/:id/members/:userId/access', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');
    const targetUserId = c.req.param('userId');

    const adminCheck = await requireOrgAdmin(orgId, authUser.userId);
    if ('error' in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const target = await dbService.getOrganizationMember(orgId, targetUserId);
    if (!target) {
      return c.json({ error: 'Member not found' }, 404);
    }
    if (target.role === 'OWNER' || target.role === 'ADMIN') {
      return c.json({ error: 'OWNER and ADMIN members always have full project access' }, 400);
    }

    const { accessAllProjects, projectIds } = updateAccessSchema.parse(await c.req.json());
    await updateMemberScope(orgId, targetUserId, { accessAllProjects, projectIds });
    return c.json({ success: true, userId: targetUserId, accessAllProjects, projectIds: accessAllProjects ? [] : projectIds });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    console.error('Update member access error:', error);
    return c.json({ error: 'Failed to update member access' }, 500);
  }
});

/**
 * DELETE /organizations/:id/members/:userId
 * Remove a member (OWNER/ADMIN). Cannot remove the last OWNER. Decrements seats.
 */
app.delete('/:id/members/:userId', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');
    const targetUserId = c.req.param('userId');

    const adminCheck = await requireOrgAdmin(orgId, authUser.userId);
    if ('error' in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const target = await dbService.getOrganizationMember(orgId, targetUserId);
    if (!target) {
      return c.json({ error: 'Member not found' }, 404);
    }

    // Guard: never remove the last OWNER.
    if (target.role === 'OWNER') {
      const members = await dbService.getOrganizationMembers(orgId);
      const ownerCount = members.filter((m) => m.role === 'OWNER').length;
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot remove the only OWNER of the organization' }, 400);
      }
    }

    // ADMINs may only remove MEMBERs (not OWNERs or other ADMINs).
    if (adminCheck.member.role === 'ADMIN' && target.role !== 'MEMBER') {
      return c.json({ error: 'ADMINs can only remove MEMBERs' }, 403);
    }

    await detachMember(orgId, targetUserId);
    return c.json({ success: true, removedUserId: targetUserId });
  } catch (error) {
    console.error('Remove member error:', error);
    return c.json({ error: 'Failed to remove member' }, 500);
  }
});

// ============================================
// INVITATIONS
// ============================================

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']).optional().default('MEMBER'),
  accessAllProjects: z.boolean().optional().default(true),
  projectIds: z.array(z.string()).optional().default([]),
});

/**
 * POST /organizations/:id/invitations
 * Invite a member by email (OWNER/ADMIN). Requires an ACTIVE paid subscription.
 */
app.post('/:id/invitations', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    const adminCheck = await requireOrgAdmin(orgId, authUser.userId);
    if ('error' in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const { email, role, accessAllProjects, projectIds } = createInviteSchema.parse(await c.req.json());
    const normalizedEmail = email.trim().toLowerCase();

    // Gate: org must be on an ACTIVE paid plan to add seats.
    const inviteGate = await canOrgInviteMembers(orgId);
    if (!inviteGate.allowed) {
      return c.json(
        {
          error: 'A paid subscription is required to add team members.',
          code: inviteGate.reason || 'PAID_PLAN_REQUIRED',
        },
        403,
      );
    }

    // Already a member?
    const existingUser = await dbService.getUserByEmail(normalizedEmail);
    if (existingUser) {
      const existingMember = await dbService.getOrganizationMember(orgId, existingUser.id);
      if (existingMember) {
        return c.json({ error: 'This user is already a member of the organization' }, 409);
      }
    }

    const { invitationId, rawToken } = await createOrRefreshInvitation({
      organizationId: orgId,
      email: normalizedEmail,
      role,
      invitedByUserId: authUser.userId,
      accessAllProjects,
      projectIds,
    });

    const org = await dbService.getOrganizationById(orgId);
    const inviter = await dbService.getUserById(authUser.userId);
    const inviterName = inviter?.display_name || inviter?.email || 'A teammate';
    const acceptUrl = `${APP_URL}/invite/${rawToken}`;

    try {
      await emailService.sendOrgInvite(normalizedEmail, org?.name || 'your team', inviterName, role, acceptUrl);
    } catch (emailErr) {
      console.error('Failed to send invite email (invitation still created):', emailErr);
    }

    return c.json({
      success: true,
      invitation: { id: invitationId, email: normalizedEmail, role, status: 'PENDING' },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    console.error('Create invitation error:', error);
    return c.json({ error: 'Failed to create invitation' }, 500);
  }
});

/**
 * GET /organizations/:id/seats/preview?seats=N
 * Estimate the prorated cost of changing to N seats for the remaining
 * current billing period (Slack-style day-based proration). This is an
 * ESTIMATE for the UI — Stripe computes the authoritative charge when the
 * seat actually changes. Defaults to current members + 1 if `seats` omitted.
 */
app.get('/:id/seats/preview', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    const adminCheck = await requireOrgAdmin(orgId, authUser.userId);
    if ('error' in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const members = await dbService.getOrganizationMembers(orgId);
    const currentSeats = Math.max(1, members.length);
    const seatsParam = c.req.query('seats');
    const newSeats = seatsParam ? Math.max(1, parseInt(seatsParam, 10) || currentSeats + 1) : currentSeats + 1;

    const orgBilling = await dbService.getOrganizationBillingByOrgId(orgId);
    const subscription = orgBilling
      ? await dbService.getSubscriptionByOrgBillingId(orgBilling.id)
      : null;
    const plan = subscription ? await dbService.getSubscriptionPlanById(subscription.plan_id) : null;
    const basePricePerSeatCents = plan?.base_price_per_seat ?? 0;

    // Day-based proration for the remaining current period (Slack formula).
    let estimatedProrationCents = 0;
    if (subscription && basePricePerSeatCents > 0) {
      const start = subscription.current_period_start;
      const end = subscription.current_period_end;
      const now = Date.now();
      const totalMs = Math.max(1, end - start);
      const remainingMs = Math.max(0, end - now);
      const fractionRemaining = Math.min(1, remainingMs / totalMs);
      const seatDelta = newSeats - currentSeats;
      estimatedProrationCents = Math.round(basePricePerSeatCents * seatDelta * fractionRemaining);
    }

    const inviteGate = await canOrgInviteMembers(orgId);

    return c.json({
      currentSeats,
      newSeats,
      basePricePerSeatCents,
      billingInterval: plan?.billing_interval ?? null,
      newRecurringTotalCents: basePricePerSeatCents * newSeats,
      estimatedProrationCents,
      requiresPaidPlan: !inviteGate.allowed,
      paidPlanReason: inviteGate.allowed ? null : inviteGate.reason ?? null,
    });
  } catch (error) {
    console.error('Seat preview error:', error);
    return c.json({ error: 'Failed to compute seat preview' }, 500);
  }
});

/**
 * GET /organizations/:id/invitations
 * List PENDING invitations (any member).
 */
app.get('/:id/invitations', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');

    const isMember = await dbService.isUserMemberOfOrganization(authUser.userId, orgId);
    if (!isMember) {
      return c.json({ error: 'Organization not found or access denied' }, 404);
    }

    const invitations = await listPendingInvitations(orgId);
    return c.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        createdAt: inv.createdAt.toISOString(),
        expiresAt: inv.expiresAt.toISOString(),
        accessAllProjects: inv.accessAllProjects,
        projectIds: inv.projectIds,
      })),
    });
  } catch (error) {
    console.error('List invitations error:', error);
    return c.json({ error: 'Failed to list invitations' }, 500);
  }
});

/**
 * DELETE /organizations/:id/invitations/:invId
 * Revoke a pending invitation (OWNER/ADMIN).
 */
app.delete('/:id/invitations/:invId', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const orgId = c.req.param('id');
    const invId = c.req.param('invId');

    const adminCheck = await requireOrgAdmin(orgId, authUser.userId);
    if ('error' in adminCheck) {
      return c.json({ error: adminCheck.error }, adminCheck.status);
    }

    const revoked = await revokeInvitation(orgId, invId);
    if (!revoked) {
      return c.json({ error: 'Invitation not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Revoke invitation error:', error);
    return c.json({ error: 'Failed to revoke invitation' }, 500);
  }
});

/**
 * GET /organizations/invitations/:token
 * Preview an invitation (authed user) for the accept page.
 */
app.get('/invitations/:token', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const token = c.req.param('token');
    const invite = await getInvitationByRawToken(token);

    if (!invite) {
      return c.json({ error: 'Invitation not found or expired' }, 404);
    }

    // The invitee may have auto-joined at login (reconcilePendingInvites flips
    // the invite to ACCEPTED) before landing here. Treat already-accepted-by-
    // this-user as a valid preview with alreadyMember=true so the page can
    // send them straight to the org instead of showing "not found".
    const alreadyMember =
      invite.status === 'ACCEPTED' && invite.acceptedByUserId === authUser.userId;

    if (!alreadyMember && (invite.status !== 'PENDING' || invite.expiresAt.getTime() <= Date.now())) {
      return c.json({ error: 'Invitation not found or expired' }, 404);
    }

    const org = await dbService.getOrganizationById(invite.organizationId);
    const inviter = await dbService.getUserById(invite.invitedByUserId);
    return c.json({
      invitation: {
        email: invite.email,
        role: invite.role,
        organizationId: invite.organizationId,
        organizationName: org?.name ?? null,
        invitedBy: inviter?.display_name || inviter?.email || null,
        expiresAt: invite.expiresAt.toISOString(),
        alreadyMember,
      },
    });
  } catch (error) {
    console.error('Preview invitation error:', error);
    return c.json({ error: 'Failed to load invitation' }, 500);
  }
});

/**
 * POST /organizations/invitations/:token/accept
 * Accept an invitation as the authenticated user.
 */
app.post('/invitations/:token/accept', standardRateLimit, async (c) => {
  try {
    const authUser = requireAuthUser(c);
    const token = c.req.param('token');

    // Authoritative email comes from the DB, not the JWT claim.
    const user = await dbService.getUserById(authUser.userId);
    if (!user?.email) {
      return c.json({ error: 'Your account has no email to match this invitation' }, 400);
    }

    const result = await acceptInvitationByToken({
      rawToken: token,
      userId: authUser.userId,
      userEmail: user.email,
    });

    if (!result.ok) {
      const map = {
        not_found: { msg: 'Invitation not found', status: 404 as const },
        expired: { msg: 'Invitation has expired', status: 410 as const },
        email_mismatch: { msg: 'This invitation was sent to a different email address', status: 403 as const },
      };
      const e = map[result.reason];
      return c.json({ error: e.msg, code: result.reason }, e.status);
    }

    return c.json({ success: true, organizationId: result.organizationId, role: result.role });
  } catch (error) {
    console.error('Accept invitation error:', error);
    return c.json({ error: 'Failed to accept invitation' }, 500);
  }
});

export default app;
