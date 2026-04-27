import { describe, it, expect } from 'vitest';
import { generateOTP, generateNonce, hashOTP, verifyOTP, isOTPExpired } from '../../src/utils/otp';

describe('OTP Utilities', () => {
  describe('generateOTP', () => {
    it('should generate 6-digit OTP by default', () => {
      const otp = generateOTP();
      expect(otp).toHaveLength(6);
      expect(/^\d{6}$/.test(otp)).toBe(true);
    });

    it('should generate OTP of custom length', () => {
      const otp = generateOTP(4);
      expect(otp).toHaveLength(4);
      expect(/^\d{4}$/.test(otp)).toBe(true);
    });

    it('should generate different OTPs', () => {
      const otp1 = generateOTP();
      const otp2 = generateOTP();
      // Very unlikely to be the same
      expect(otp1).not.toBe(otp2);
    });
  });

  describe('generateNonce', () => {
    it('should generate URL-safe base64 nonce', () => {
      const nonce = generateNonce();
      expect(nonce).toBeTruthy();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);
      expect(/^[A-Za-z0-9_-]+$/.test(nonce)).toBe(true);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('hashOTP', () => {
    it('should hash OTP consistently', () => {
      const otp = '123456';
      const hash1 = hashOTP(otp);
      const hash2 = hashOTP(otp);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different OTPs', () => {
      const hash1 = hashOTP('123456');
      const hash2 = hashOTP('654321');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyOTP', () => {
    it('should verify correct OTP', () => {
      const otp = '123456';
      const hash = hashOTP(otp);
      expect(verifyOTP(otp, hash)).toBe(true);
    });

    it('should reject incorrect OTP', () => {
      const otp = '123456';
      const hash = hashOTP(otp);
      expect(verifyOTP('654321', hash)).toBe(false);
    });
  });

  describe('isOTPExpired', () => {
    it('should return false for recent OTP', () => {
      const now = Date.now();
      expect(isOTPExpired(now, 10)).toBe(false);
    });

    it('should return true for expired OTP', () => {
      const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
      expect(isOTPExpired(elevenMinutesAgo, 10)).toBe(true);
    });

    it('should respect custom expiry time', () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
      expect(isOTPExpired(sixMinutesAgo, 5)).toBe(true);
      expect(isOTPExpired(sixMinutesAgo, 10)).toBe(false);
    });
  });
});
