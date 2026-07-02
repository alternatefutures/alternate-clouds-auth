/**
 * Email service for sending verification codes
 * Using Resend API (https://resend.com)
 */

import { secretsService } from './secrets.service';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailService {
  private fromEmail: string;

  constructor(fromEmail: string = 'auth@alternatefutures.ai') {
    this.fromEmail = fromEmail;
  }

  private get apiKey(): string {
    return secretsService.get('RESEND_API_KEY') || '';
  }

  /**
   * Send an email using Resend API
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    const { to, subject, text, html } = options;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [to],
          subject,
          text,
          html: html || text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to send email: ${error}`);
      }

      const data = await response.json();
      console.log('Email sent successfully:', data);
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  /**
   * Send verification code email
   */
  async sendVerificationCode(email: string, code: string): Promise<void> {
    const hasApiKey = !!this.apiKey;
    const isDev = process.env.NODE_ENV === 'development';

    console.log('📧 Email service sendVerificationCode called:');
    console.log(`   - Has API key: ${hasApiKey}`);
    console.log(`   - API key length: ${this.apiKey?.length || 0}`);
    console.log(`   - NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`   - Is development mode: ${isDev}`);

    // In development without API key, just log the code
    if (!hasApiKey || isDev) {
      console.log('\n🔐 ========================================');
      console.log('📧 VERIFICATION CODE (Development Mode)');
      console.log(`   Reason: ${!hasApiKey ? 'No API key' : 'Development environment'}`);
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Code: ${code}`);
      console.log('Expires: 10 minutes');
      console.log('========================================\n');
      return;
    }

    const subject = 'Your Alternate Clouds Verification Code';
    const text = `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .code { font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0026FF; text-align: center; padding: 20px; background: #F8F5EE; border-radius: 8px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; margin-top: 40px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Verify Your Email</h2>
            <p>Your verification code is:</p>
            <div class="code">${code}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this code, please ignore this email.</p>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({ to: email, subject, text, html });
  }

  /**
   * Send magic link email
   */
  async sendMagicLink(email: string, magicLink: string): Promise<void> {
    const subject = 'Sign in to Alternate Clouds';
    const text = `Click the link below to sign in:\n\n${magicLink}\n\nThis link will expire in 15 minutes.\n\nIf you didn't request this link, please ignore this email.`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { display: inline-block; padding: 12px 24px; background: #0026FF; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; margin-top: 40px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Sign in to Alternate Clouds</h2>
            <p>Click the button below to sign in:</p>
            <a href="${magicLink}" class="button">Sign In</a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${magicLink}</p>
            <p>This link will expire in <strong>15 minutes</strong>.</p>
            <p>If you didn't request this link, please ignore this email.</p>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({ to: email, subject, text, html });
  }
  async sendTrialExpiredEmail(email: string, orgName: string, orgId: string, gracedays: number = 3): Promise<void> {
    if (!this.apiKey || process.env.NODE_ENV === 'development') {
      console.log(`[Email] Trial expired notification for ${email} (org: ${orgName})`);
      return;
    }

    const subject = `[Alternate Clouds] Your trial has ended — ${gracedays} days to subscribe`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f59e0b;">Your Trial Has Ended</h2>
            <p>Hi,</p>
            <p>Your free trial for <strong>${orgName}</strong> on Alternate Clouds has ended.</p>
            <p>You have <strong>${gracedays} days</strong> to subscribe before your access is suspended.
            During this grace period, all features remain available.</p>
            <a href="https://app.alternatefutures.ai/org/${orgId}/billing"
               style="display: inline-block; background: #0026FF; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0; font-weight: 600;">
              Subscribe Now
            </a>
            <p style="color: #6b7280; font-size: 14px;">
              After the grace period, deployments, AI inference, and all platform features
              will be disabled until you subscribe.
            </p>
            <div style="font-size: 12px; color: #666; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
              <p>&copy; ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject,
      text: `Your free trial for ${orgName} has ended. Subscribe within ${gracedays} days at https://app.alternatefutures.ai/org/${orgId}/billing`,
      html,
    });
  }

  /**
   * Confirm to the user that we received their access request.
   * Intentionally short — the goal is just "we got it, you'll hear back".
   * Falls back to console logging in dev / when no API key is set.
   */
  async sendWhitelistRequestReceived(email: string, name: string): Promise<void> {
    if (!this.apiKey || process.env.NODE_ENV === 'development') {
      console.log(`[Email] Whitelist request received for ${email} (${name})`);
      return;
    }

    const subject = `We received your Alternate Clouds access request`;
    const safeName = name && name.trim().length > 0 ? name.trim() : 'there';
    const text = `Hi ${safeName},\n\nThanks for requesting access to Alternate Clouds. We'll review your request and get back to you soon.\n\n— The Alternate Clouds team`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #0026FF;">Request received</h2>
            <p>Hi ${safeName},</p>
            <p>Thanks for requesting access to <strong>Alternate Clouds</strong>. We'll review your request and get back to you soon.</p>
            <p style="color: #6b7280; font-size: 14px;">
              In the meantime, feel free to follow our progress on
              <a href="https://x.com/AltFuturesAI" style="color: #0026FF;">X</a>,
              <a href="https://www.linkedin.com/company/alternate-futures-ai" style="color: #0026FF;">LinkedIn</a>, or
              <a href="https://discord.gg/YW6zZfZZUU" style="color: #0026FF;">Discord</a>.
            </p>
            <div style="font-size: 12px; color: #666; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
              <p>&copy; ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({ to: email, subject, text, html });
  }

  /**
   * Notify the user that their access request was approved and link
   * them straight to the sign-in page.
   */
  async sendWhitelistApproved(email: string, name: string, signInUrl: string): Promise<void> {
    if (!this.apiKey || process.env.NODE_ENV === 'development') {
      console.log(`[Email] Whitelist approved for ${email} (${name})`);
      return;
    }

    const subject = `You're in — welcome to Alternate Clouds`;
    const safeName = name && name.trim().length > 0 ? name.trim() : 'there';
    const text = `Hi ${safeName},\n\nGood news — your Alternate Clouds access request was approved. Sign in here:\n\n${signInUrl}\n\n— The Alternate Clouds team`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #10b981;">You're in</h2>
            <p>Hi ${safeName},</p>
            <p>Good news — your access request was approved. You can sign in to <strong>Alternate Clouds</strong> now:</p>
            <a href="${signInUrl}"
               style="display: inline-block; background: #0026FF; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0; font-weight: 600;">
              Sign in
            </a>
            <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, paste this link into your browser:<br/>
              <span style="word-break: break-all;">${signInUrl}</span>
            </p>
            <div style="font-size: 12px; color: #666; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
              <p>&copy; ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({ to: email, subject, text, html });
  }

  async sendAccessSuspendedEmail(email: string, orgName: string, orgId: string): Promise<void> {
    if (!this.apiKey || process.env.NODE_ENV === 'development') {
      console.log(`[Email] Access suspended notification for ${email} (org: ${orgName})`);
      return;
    }

    const subject = `[Alternate Clouds] Your access has been suspended`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ef4444;">Access Suspended</h2>
            <p>Hi,</p>
            <p>Your grace period for <strong>${orgName}</strong> has ended. All platform features
            have been suspended, including deployments, AI inference, and the assistant.</p>
            <p>Subscribe to restore full access immediately:</p>
            <a href="https://app.alternatefutures.ai/org/${orgId}/billing"
               style="display: inline-block; background: #0026FF; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0; font-weight: 600;">
              Subscribe Now
            </a>
            <p style="color: #6b7280; font-size: 14px;">
              Your data and configurations are safe. Once you subscribe, everything
              will be restored.
            </p>
            <div style="font-size: 12px; color: #666; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
              <p>&copy; ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject,
      text: `Your access to ${orgName} on Alternate Clouds has been suspended. Subscribe at https://app.alternatefutures.ai/org/${orgId}/billing to restore access.`,
      html,
    });
  }

  /**
   * Send an organization team invitation with an accept link.
   * The accept link contains a one-time raw token (hashed at rest).
   */
  async sendOrgInvite(
    email: string,
    orgName: string,
    inviterName: string,
    role: string,
    acceptUrl: string,
  ): Promise<void> {
    if (!this.apiKey || process.env.NODE_ENV === 'development') {
      console.log('\n👥 ========================================');
      console.log('📧 ORG INVITE (Development Mode)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Org: ${orgName} | Role: ${role}`);
      console.log(`Accept URL: ${acceptUrl}`);
      console.log('========================================\n');
      return;
    }

    const subject = `${inviterName} invited you to join ${orgName} on Alternate Clouds`;
    const text = `${inviterName} invited you to join ${orgName} as a ${role} on Alternate Clouds.\n\nAccept the invitation:\n${acceptUrl}\n\nThis invitation expires in 7 days. If you weren't expecting this, you can ignore this email.`;
    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>You've been invited to ${orgName}</h2>
            <p><strong>${inviterName}</strong> invited you to join <strong>${orgName}</strong> as a <strong>${role}</strong> on Alternate Clouds.</p>
            <a href="${acceptUrl}"
               style="display: inline-block; background: #0026FF; color: white; padding: 12px 24px;
                      border-radius: 6px; text-decoration: none; margin: 16px 0; font-weight: 600;">
              Accept Invitation
            </a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${acceptUrl}</p>
            <p style="color: #6b7280; font-size: 14px;">This invitation expires in <strong>7 days</strong>. If you weren't expecting this, you can ignore this email.</p>
            <div style="font-size: 12px; color: #666; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
              <p>&copy; ${new Date().getFullYear()} Alternate Clouds. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({ to: email, subject, text, html });
  }
}

// Create singleton instance
const fromEmail = process.env.FROM_EMAIL || 'auth@alternatefutures.ai';

console.log('📧 Email Service Config:');
console.log('  From Email:', fromEmail);
console.log('  (API Key loaded from secrets service at runtime)');

export const emailService = new EmailService(fromEmail);
