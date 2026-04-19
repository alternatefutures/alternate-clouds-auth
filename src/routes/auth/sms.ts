import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { smsService } from '../../services/sms.service';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { generateOTP } from '../../utils/otp';
import { smsAuthRequestSchema, smsAuthVerifySchema } from '../../utils/validators';
import { strictRateLimit } from '../../middleware/ratelimit';
import { timingSafeCompare } from '../../utils/crypto';
import { whitelistService } from '../../services/whitelist.service';
import { auditLogService } from '../../services/auditLog.service';
import { audit } from '../../lib/audit';
import { notifyNewSignup } from '../../lib/discordNotifier';
import { generateDeviceFingerprint } from '../../utils/fingerprint';

const app = new Hono();

/**
 * POST /auth/sms/request
 * Request SMS verification code
 */
app.post('/request', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { phone } = smsAuthRequestSchema.parse(body);

    // Generate OTP code
    const code = generateOTP(6);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store verification code in database
    await dbService.createVerificationCode({
      id: nanoid(),
      code_type: 'sms',
      identifier: phone,
      code,
      expires_at: expiresAt,
      attempts: 0,
      max_attempts: 3,
      verified: 0,
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    });

    // Send SMS with verification code
    await smsService.sendVerificationCode(phone, code);

    await auditLogService.logFromContext(c, {
      eventType: 'OTP_ISSUED',
      metadata: { method: 'sms', identifier: phone },
    });

    return c.json({
      success: true,
      message: 'Verification code sent to your phone',
      expiresIn: 600, // seconds
    });
  } catch (error) {
    console.error('SMS request error:', error);

    await auditLogService.logFromContext(c, {
      eventType: 'OTP_ISSUED',
      metadata: {
        method: 'sms',
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid phone number' }, 400);
    }

    return c.json({ error: 'Failed to send verification code' }, 500);
  }
});

/**
 * POST /auth/sms/verify
 * Verify SMS code and issue JWT tokens
 */
app.post('/verify', strictRateLimit, async (c) => {
  try {
    // Validate request body
    const body = await c.req.json();
    const { phone, code } = smsAuthVerifySchema.parse(body);

    // Get verification code from database
    const verificationCode = await dbService.getVerificationCode(phone, 'sms');

    if (!verificationCode) {
      return c.json({ error: 'No verification code found for this phone number' }, 404);
    }

    // Check if code has expired
    if (Date.now() > verificationCode.expires_at) {
      return c.json({ error: 'Verification code has expired' }, 400);
    }

    // Check if max attempts exceeded
    if (verificationCode.attempts >= verificationCode.max_attempts) {
      return c.json({ error: 'Maximum verification attempts exceeded' }, 429);
    }

    // Fixed by audit 2026-03: timing-safe OTP comparison (was !== operator)
    if (!timingSafeCompare(verificationCode.code, code)) {
      await dbService.incrementVerificationAttempts(verificationCode.id);

      await auditLogService.logFromContext(c, {
        eventType: 'LOGIN_FAILURE',
        metadata: { method: 'sms', reason: 'invalid_code', identifier: phone },
      });

      return c.json({ error: 'Invalid verification code' }, 400);
    }

    // Check if already verified
    if (verificationCode.verified) {
      return c.json({ error: 'Verification code already used' }, 400);
    }

    // Mark code as verified
    await dbService.markVerificationCodeAsUsed(verificationCode.id);

    // Whitelist gate
    const wl = await whitelistService.check403(phone);
    if (wl) return c.json(wl.body, wl.status);

    // Check if user exists with this phone number
    let user = await dbService.getUserByPhone(phone);

    if (!user) {
      // Create new user
      user = await dbService.createUser({
        id: nanoid(),
        phone,
        phone_verified: 1,
        email_verified: 0,
      });

      // Create auth method
      await dbService.createAuthMethod({
        id: nanoid(),
        user_id: user.id,
        method_type: 'sms',
        identifier: phone,
        verified: 1,
        is_primary: 1,
      });

      // Create default organization for new user
      const orgSlug = `user-${user.id.slice(0, 8)}`;
      const orgName = phone.slice(-4);

      try {
        await dbService.createDefaultOrganizationForUser({
          orgId: nanoid(),
          memberId: nanoid(),
          billingId: nanoid(),
          billingCustomerId: nanoid(),
          subscriptionId: nanoid(),
          userId: user.id,
          orgSlug,
          orgName: `User ${orgName}'s Org`,
        });
      } catch (orgError: any) {
        console.error(`[sms-onboard] Org creation failed for user ${user.id}:`, orgError?.message || orgError);
        audit(dbService.prismaClient, {
          category: 'user',
          action: 'user.signup',
          status: 'error',
          userId: user.id,
          errorCode: orgError?.code,
          errorMessage: orgError?.message ?? String(orgError),
          payload: { method: 'sms', step: 'default_org_create' },
        });
        return c.json({ error: 'Account setup failed. Please try again.' }, 500);
      }

      audit(dbService.prismaClient, {
        category: 'user',
        action: 'user.signup',
        status: 'ok',
        userId: user.id,
        payload: { method: 'sms' },
      });

      void notifyNewSignup({
        userId: user.id,
        email: null,
        identifier: phone,
        method: 'SMS',
        createdAt: new Date(),
      });
    } else {
      // Update existing user
      await dbService.updateUser(user.id, {
        phone_verified: 1,
        last_login_at: Date.now(),
      });

      // Update or create auth method
      const authMethod = await dbService.getAuthMethodByIdentifier(phone, 'sms');
      if (!authMethod) {
        await dbService.createAuthMethod({
          id: nanoid(),
          user_id: user.id,
          method_type: 'sms',
          identifier: phone,
          verified: 1,
          is_primary: 0,
        });
      }

      // Ensure existing user has an organization
      const existingOrgs = await dbService.getOrganizationsByUserId(user.id);
      if (existingOrgs.length === 0) {
        const orgSlug = `user-${user.id.slice(0, 8)}`;
        const orgName = phone.slice(-4);

        try {
          await dbService.createDefaultOrganizationForUser({
            orgId: nanoid(),
            memberId: nanoid(),
            billingId: nanoid(),
            billingCustomerId: nanoid(),
            subscriptionId: nanoid(),
            userId: user.id,
            orgSlug,
            orgName: `User ${orgName}'s Org`,
          });
        } catch (orgError: any) {
          console.error(`[sms-onboard] Org creation failed for existing user ${user.id}:`, orgError?.message || orgError);
          return c.json({ error: 'Account setup failed. Please try again.' }, 500);
        }
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken, sessionId } = jwtService.generateTokenPair(
      user.id,
      phone
    );

    // Store session
    const deviceId = generateDeviceFingerprint(c);
    await dbService.createSession({
      id: sessionId,
      user_id: user.id,
      refresh_token: refreshToken,
      token_family: randomUUID(),
      token_version: 0,
      expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      user_agent: c.req.header('user-agent'),
      device_id: deviceId,
      revoked: 0,
    });

    await auditLogService.logFromContext(c, {
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      metadata: { method: 'sms', deviceId },
    });

    return c.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error('SMS verify error:', error);

    if (error instanceof Error && error.message.includes('validation')) {
      return c.json({ error: 'Invalid phone number or code' }, 400);
    }

    return c.json({ error: 'Failed to verify code' }, 500);
  }
});

export default app;
