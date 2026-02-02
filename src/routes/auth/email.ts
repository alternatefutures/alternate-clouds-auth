import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { emailService } from '../../services/email.service';
import { dbService } from '../../services/db.service';
import { jwtService } from '../../services/jwt.service';
import { generateOTP } from '../../utils/otp';
import { emailAuthRequestSchema, emailAuthVerifySchema } from '../../utils/validators';
import { strictRateLimit } from '../../middleware/ratelimit';

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

    // Verify code
    if (verificationCode.code !== code) {
      // Increment attempt counter
      await dbService.incrementVerificationAttempts(verificationCode.id);

      return c.json({
        error: 'Invalid verification code',
        attemptsRemaining: verificationCode.max_attempts - verificationCode.attempts - 1,
      }, 400);
    }

    // Mark code as used
    await dbService.markVerificationCodeAsUsed(verificationCode.id);

    // Check if user exists
    let user = await dbService.getUserByEmail(email);
    let isNewUser = false;

    console.log('[DEBUG] Email verify - user lookup result:', user ? `found user ${user.id}` : 'no user found');

    if (!user) {
      isNewUser = true;
      console.log('[DEBUG] Creating new user for email:', email);
      
      // Create new user
      user = await dbService.createUser({
        id: nanoid(),
        email,
        email_verified: 1,
        phone_verified: 0,
      });
      console.log('[DEBUG] Created user:', user.id);

      // Create auth method
      await dbService.createAuthMethod({
        id: nanoid(),
        user_id: user.id,
        method_type: 'email',
        identifier: email,
        verified: 1,
        is_primary: 1,
      });
      console.log('[DEBUG] Created auth method for user:', user.id);

      // Create default organization for new user
      const orgSlug = `user-${user.id.slice(0, 8)}`;
      const orgName = email.split('@')[0] || 'My Organization';
      console.log('[DEBUG] Creating default org for NEW user:', { orgSlug, orgName, userId: user.id });
      
      try {
        const org = await dbService.createDefaultOrganizationForUser({
          orgId: nanoid(),
          memberId: nanoid(),
          billingId: nanoid(),
          billingCustomerId: nanoid(),
          subscriptionId: nanoid(),
          userId: user.id,
          orgSlug,
          orgName: `${orgName}'s Org`,
        });
        console.log('[DEBUG] Created org for new user:', org);
      } catch (orgError) {
        console.error('[DEBUG] ERROR creating org for new user:', orgError);
      }
    } else {
      console.log('[DEBUG] Existing user found:', user.id);
      
      // Update email verification status
      await dbService.updateUser(user.id, {
        email_verified: 1,
        last_login_at: Date.now(),
      });

      // Check if existing user has an organization, create one if not
      const existingOrgs = await dbService.getOrganizationsByUserId(user.id);
      console.log('[DEBUG] Existing user orgs:', existingOrgs.length, existingOrgs);
      
      if (existingOrgs.length === 0) {
        const orgSlug = `user-${user.id.slice(0, 8)}`;
        const orgName = email.split('@')[0] || 'My Organization';
        console.log('[DEBUG] Creating default org for EXISTING user:', { orgSlug, orgName, userId: user.id });
        
        try {
          const org = await dbService.createDefaultOrganizationForUser({
            orgId: nanoid(),
            memberId: nanoid(),
            billingId: nanoid(),
            billingCustomerId: nanoid(),
            subscriptionId: nanoid(),
            userId: user.id,
            orgSlug,
            orgName: `${orgName}'s Org`,
          });
          console.log('[DEBUG] Created org for existing user:', org);
        } catch (orgError) {
          console.error('[DEBUG] ERROR creating org for existing user:', orgError);
        }
      } else {
        console.log('[DEBUG] User already has orgs, skipping creation');
      }
    }

    // Generate JWT tokens
    const { accessToken, refreshToken, sessionId } = jwtService.generateTokenPair(
      user.id,
      email
    );

    // Store session in database
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await dbService.createSession({
      id: sessionId,
      user_id: user.id,
      refresh_token: refreshToken,
      user_agent: c.req.header('user-agent'),
      ip_address: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      expires_at: expiresAt,
      revoked: 0,
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
