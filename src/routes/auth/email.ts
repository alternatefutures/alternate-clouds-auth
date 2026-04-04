import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { emailService } from '../../services/email.service';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { generateOTP } from '../../utils/otp';
import { emailAuthRequestSchema, emailAuthVerifySchema } from '../../utils/validators';
import { timingSafeCompare } from '../../utils/crypto';
import { strictRateLimit } from '../../middleware/ratelimit';
import { whitelistService } from '../../services/whitelist.service';
import { auditLogService } from '../../services/auditLog.service';
import { generateDeviceFingerprint } from '../../utils/fingerprint';

const app = new Hono();

/**
 * POST /auth/email/request
 * Request email verification code
 */
app.post('/request', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { email } = emailAuthRequestSchema.parse(body);

    // Whitelist gate — reject before sending OTP to save the email and user's time
    const wl = await whitelistService.check403(email);
    if (wl) return c.json(wl.body, wl.status);

    // Generate OTP code
    const code = generateOTP(6);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store verification code in database
    await dbService.createVerificationCode({
      id: nanoid(),
      code_type: 'email',
      identifier: email,
      code,
      expires_at: expiresAt,
      attempts: 0,
      max_attempts: 3,
      verified: 0,
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    });

    // Send email with verification code
    await emailService.sendVerificationCode(email, code);

    return c.json({
      success: true,
      message: 'Verification code sent to your email',
      expiresIn: 600, // seconds
    });
  } catch (error) {
    console.error('Email request error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid email address' }, 400);
    }

    return c.json({ error: 'Failed to send verification code' }, 500);
  }
});

/**
 * POST /auth/email/verify
 * Verify email code and issue JWT tokens
 */
app.post('/verify', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { email, code } = emailAuthVerifySchema.parse(body);

    // Get verification code from database
    const verificationCode = await dbService.getVerificationCode(email, 'email');

    if (!verificationCode) {
      return c.json({ error: 'No verification code found for this email' }, 404);
    }

    // Check if code has expired
    if (Date.now() > verificationCode.expires_at) {
      return c.json({ error: 'Verification code has expired' }, 400);
    }

    // Check if max attempts exceeded
    if (verificationCode.attempts >= verificationCode.max_attempts) {
      return c.json({ error: 'Too many failed attempts. Please request a new code.' }, 400);
    }

    // Verify code (timing-safe comparison to prevent timing attacks)
    if (!timingSafeCompare(verificationCode.code, code)) {
      await dbService.incrementVerificationAttempts(verificationCode.id);

      await auditLogService.logFromContext(c, {
        eventType: 'LOGIN_FAILURE',
        metadata: { method: 'email', reason: 'invalid_code', identifier: email },
      });

      return c.json({
        error: 'Invalid verification code',
        attemptsRemaining: verificationCode.max_attempts - verificationCode.attempts - 1,
      }, 400);
    }

    // Mark code as used
    await dbService.markVerificationCodeAsUsed(verificationCode.id);

    // Whitelist gate — blocks non-whitelisted users before any user creation or token issuance
    const wl = await whitelistService.check403(email);
    if (wl) return c.json(wl.body, wl.status);

    // Check if user exists
    let user = await dbService.getUserByEmail(email);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      
      // Create new user
      user = await dbService.createUser({
        id: nanoid(),
        email,
        email_verified: 1,
        phone_verified: 0,
      });

      // Create auth method
      await dbService.createAuthMethod({
        id: nanoid(),
        user_id: user.id,
        method_type: 'email',
        identifier: email,
        verified: 1,
        is_primary: 1,
      });

      // Create default organization for new user
      const orgSlug = `user-${user.id.slice(0, 8)}`;
      const orgName = email.split('@')[0] || 'My Organization';
      
      try {
        console.log(`[org-create] Creating default org for NEW user ${user.id}...`);
        await dbService.createDefaultOrganizationForUser({
          orgId: nanoid(),
          memberId: nanoid(),
          billingId: nanoid(),
          billingCustomerId: nanoid(),
          subscriptionId: nanoid(),
          userId: user.id,
          orgSlug,
          orgName: `${orgName}'s Org`,
        });
        console.log(`[org-create] ✓ Default org created for user ${user.id}`);
      } catch (orgError: any) {
        console.error(`[org-create] ✖ Failed for new user ${user.id}:`, orgError?.message || orgError);
        console.error(`[org-create]   Code: ${orgError?.code}, Meta: ${JSON.stringify(orgError?.meta)}`);
        return c.json({ error: 'Account setup failed. Please try again.' }, 500);
      }
    } else {
      // Update email verification status
      await dbService.updateUser(user.id, {
        email_verified: 1,
        last_login_at: Date.now(),
      });

      // Check if existing user has an organization, create one if not
      const existingOrgs = await dbService.getOrganizationsByUserId(user.id);
      
      if (existingOrgs.length === 0) {
        const orgSlug = `user-${user.id.slice(0, 8)}`;
        const orgName = email.split('@')[0] || 'My Organization';
        
        try {
          console.log(`[org-create] Creating default org for EXISTING user ${user.id} (0 orgs)...`);
          await dbService.createDefaultOrganizationForUser({
            orgId: nanoid(),
            memberId: nanoid(),
            billingId: nanoid(),
            billingCustomerId: nanoid(),
            subscriptionId: nanoid(),
            userId: user.id,
            orgSlug,
            orgName: `${orgName}'s Org`,
          });
          console.log(`[org-create] ✓ Default org created for existing user ${user.id}`);
        } catch (orgError: any) {
          console.error(`[org-create] ✖ Failed for existing user ${user.id}:`, orgError?.message || orgError);
          console.error(`[org-create]   Code: ${orgError?.code}, Meta: ${JSON.stringify(orgError?.meta)}`);
          return c.json({ error: 'Account setup failed. Please try again.' }, 500);
        }
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken, sessionId } = jwtService.generateTokenPair(
      user.id,
      email
    );

    // Store session in database
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const deviceId = generateDeviceFingerprint(c);
    await dbService.createSession({
      id: sessionId,
      user_id: user.id,
      refresh_token: refreshToken,
      token_family: randomUUID(),
      token_version: 0,
      user_agent: c.req.header('user-agent'),
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      device_id: deviceId,
      expires_at: expiresAt,
      revoked: 0,
    });

    await auditLogService.logFromContext(c, {
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      metadata: { method: 'email', isNewUser, deviceId },
    });

    return c.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    console.error('Email verify error:', error);

    if (error instanceof Error && error.message.includes('validation')) {
      return c.json({ error: 'Invalid request data' }, 400);
    }

    return c.json({ error: 'Failed to verify code' }, 500);
  }
});

export default app;
