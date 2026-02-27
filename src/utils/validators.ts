import { z } from 'zod';

// Email validation — always normalize to lowercase for case-insensitive uniqueness
export const emailSchema = z.string().email('Invalid email address').transform((e) => e.toLowerCase());

// Phone validation (E.164 format)
export const phoneSchema = z.string().regex(
  /^\+[1-9]\d{1,14}$/,
  'Invalid phone number. Must be in E.164 format (e.g., +1234567890)'
);

// Ethereum address validation
export const ethereumAddressSchema = z.string().regex(
  /^0x[a-fA-F0-9]{40}$/,
  'Invalid Ethereum address'
);

// Solana address validation
export const solanaAddressSchema = z.string().regex(
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  'Invalid Solana address'
);

// OTP code validation (6 digits)
export const otpSchema = z.string().regex(
  /^\d{6}$/,
  'OTP must be 6 digits'
);

// Password validation (if needed later)
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Request schemas
export const emailAuthRequestSchema = z.object({
  email: emailSchema,
});

export const emailAuthVerifySchema = z.object({
  email: emailSchema,
  code: otpSchema,
});

export const smsAuthRequestSchema = z.object({
  phone: phoneSchema,
});

export const smsAuthVerifySchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
});

export const walletChallengeRequestSchema = z.object({
  address: z.union([ethereumAddressSchema, solanaAddressSchema]),
  chainId: z.number().optional(),
});

export const walletVerifySchema = z.object({
  address: z.union([ethereumAddressSchema, solanaAddressSchema]),
  signature: z.string(),
  message: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// Helper functions
export function validateEmail(email: string): boolean {
  try {
    emailSchema.parse(email);
    return true;
  } catch {
    return false;
  }
}

export function validatePhone(phone: string): boolean {
  try {
    phoneSchema.parse(phone);
    return true;
  } catch {
    return false;
  }
}

export function validateEthereumAddress(address: string): boolean {
  try {
    ethereumAddressSchema.parse(address);
    return true;
  } catch {
    return false;
  }
}

export function validateSolanaAddress(address: string): boolean {
  try {
    solanaAddressSchema.parse(address);
    return true;
  } catch {
    return false;
  }
}
