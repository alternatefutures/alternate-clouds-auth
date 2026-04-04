/**
 * Cryptographic utilities for secure token handling
 */

import { createHash, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Hash a token/secret using SHA-256
 * Used for storing tokens at rest (refresh tokens, PATs, etc.)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Verify a token against its hash using timing-safe comparison
 * Prevents timing attacks when comparing secrets
 */
export function verifyTokenHash(token: string, hash: string): boolean {
  const tokenHash = hashToken(token);
  
  // Both must be the same length for timingSafeEqual
  // SHA-256 always produces 64 hex characters
  if (tokenHash.length !== hash.length) {
    return false;
  }
  
  try {
    return timingSafeEqual(Buffer.from(tokenHash, 'utf8'), Buffer.from(hash, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Timing-safe string comparison
 * Use this instead of === or !== for comparing secrets
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Get the encryption key from environment or derive from JWT secret
 * Must be 32 bytes for AES-256
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey) {
    // If provided, hash it to ensure correct length
    return createHash('sha256').update(envKey, 'utf8').digest();
  }
  
  // Fall back to deriving from JWT secret (not ideal but better than nothing)
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('TOKEN_ENCRYPTION_KEY or JWT_SECRET must be set for token encryption');
  }
  
  return createHash('sha256').update(jwtSecret, 'utf8').digest();
}

/**
 * Encrypt sensitive data for short-term storage (e.g., OAuth exchange codes)
 * Uses AES-256-GCM for authenticated encryption
 * Returns: base64(iv + authTag + ciphertext)
 */
export function encryptForStorage(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96 bits for GCM
  
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // Combine: iv (12 bytes) + authTag (16 bytes) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt data that was encrypted with encryptForStorage
 */
export function decryptFromStorage(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');
  
  // Extract components
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const ciphertext = combined.subarray(28);
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

// ============================================
// PKCE (Proof Key for Code Exchange) Utilities
// ============================================

/**
 * Generate a cryptographically random code verifier for PKCE
 * Per RFC 7636: 43-128 characters from [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
export function generateCodeVerifier(): string {
  // Generate 32 random bytes (256 bits of entropy)
  const buffer = randomBytes(32);
  // Base64url encode (without padding)
  return buffer.toString('base64url');
}

/**
 * Generate code challenge from code verifier using S256 method
 * Per RFC 7636: code_challenge = BASE64URL(SHA256(code_verifier))
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256').update(codeVerifier, 'ascii').digest();
  return hash.toString('base64url');
}

/**
 * Verify that a code verifier matches a code challenge
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const expectedChallenge = generateCodeChallenge(codeVerifier);
  return timingSafeCompare(expectedChallenge, codeChallenge);
}
