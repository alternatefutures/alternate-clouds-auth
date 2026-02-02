import { Hono } from 'hono';
import { z } from 'zod';
import { dbService } from '../../services/db.service';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { standardRateLimit } from '../../middleware/ratelimit';

const app = new Hono();

// All routes require authentication
app.use('*', authMiddleware);

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

export default app;
