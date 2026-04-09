/**
 * SMS service for sending verification codes
 * Using Twilio (https://twilio.com)
 */

import Twilio from 'twilio';

export interface SMSOptions {
  to: string;
  body: string;
}

export class SMSService {
  private client: Twilio.Twilio | null;
  private phoneNumber: string;
  private accountSid: string;
  private authToken: string;

  constructor(accountSid: string, authToken: string, phoneNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.phoneNumber = phoneNumber;

    // Only initialize client if credentials are provided
    this.client = accountSid && authToken ? Twilio(accountSid, authToken) : null;
  }

  /**
   * Send an SMS using Twilio API
   */
  async sendSMS(options: SMSOptions): Promise<void> {
    const { to, body } = options;

    if (!this.client) {
      throw new Error('SMS service not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    }

    try {
      const message = await this.client.messages.create({
        from: this.phoneNumber,
        to: to,
        body: body,
      });

      console.log('SMS sent successfully:', message.sid);
    } catch (error) {
      console.error('Error sending SMS:', error);
      throw error;
    }
  }

  /**
   * Send verification code SMS
   */
  async sendVerificationCode(phoneNumber: string, code: string): Promise<void> {
    // In development/test without credentials, just log the code
    if (!this.accountSid || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log('\n🔐 ========================================');
      console.log('📱 VERIFICATION CODE (Development Mode)');
      console.log('========================================');
      console.log(`Phone: ${phoneNumber}`);
      console.log(`Code: ${code}`);
      console.log('Expires: 10 minutes');
      console.log('========================================\n');
      return;
    }

    const body = `Your Alternate Clouds verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this message.`;

    await this.sendSMS({
      to: phoneNumber,
      body,
    });
  }

  /**
   * Send a custom SMS message
   */
  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    await this.sendSMS({
      to: phoneNumber,
      body: message,
    });
  }
}

// Export singleton instance
export const smsService = new SMSService(
  process.env.TWILIO_ACCOUNT_SID || '',
  process.env.TWILIO_AUTH_TOKEN || '',
  process.env.TWILIO_PHONE_NUMBER || ''
);

console.log('📱 SMS Service Config (Twilio):');
console.log(`  Account SID: ${process.env.TWILIO_ACCOUNT_SID ? 'Configured' : 'Not configured'}`);
console.log(`  From Number: ${maskPhoneNumber(process.env.TWILIO_PHONE_NUMBER)}`);

/**
 * Mask all but last 2 digits of a phone number for safe logging.
 * If undefined or empty, return 'Not configured'.
 */
function maskPhoneNumber(number?: string): string {
  if (!number || number.length < 2) return 'Not configured';
  const visible = number.slice(-2);
  return `***${visible}`;
}
