/**
 * Personal Access Token Service
 *
 * Handles creation, validation, and deletion of API tokens.
 * Tokens follow the format: af_live_<random_base62_string> or af_test_<random_base62_string>
 * 
 * SECURITY: Tokens are hashed before storage using SHA-256.
 * The plaintext token is only returned once at creation time.
 */

import { randomBytes } from 'crypto';
import { nanoid, customAlphabet } from 'nanoid';
import { DatabaseService } from './db.service.js';
import { rateLimiter } from './rateLimiter.service.js';
import { tokenServiceLogger } from '../utils/logger.js';
import { hashToken, verifyTokenHash } from '../utils/crypto.js';

const TOKEN_PREFIX = 'af';
const TOKEN_LENGTH = 32; // Length of the random part

// Error interfaces
interface RateLimitError extends Error {
  code: string;
  resetAt: Date;
}

interface TokenCollisionError extends Error {
  retry: boolean;
}

interface TokenLimitError extends Error {
  code: string;
}

export class TokenService {
  private db: DatabaseService;

  // Rate limit: 50 tokens per day per user
  private static readonly RATE_LIMIT = 50;
  private static readonly RATE_LIMIT_WINDOW = 24 * 60 * 60; // 24 hours in seconds

  // Max active tokens: 500 per user
  private static readonly MAX_ACTIVE_TOKENS = 500;

  // Max retries for token generation
  private static readonly MAX_RETRIES = 5;

  // Token name validation constraints
  private static readonly MIN_NAME_LENGTH = 1;
  private static readonly MAX_NAME_LENGTH = 100;
  private static readonly VALID_NAME_PATTERN = /^[a-zA-Z0-9\s\-_\.]+$/;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Validate token name for security and correctness
   * Prevents XSS, injection attacks, and ensures reasonable constraints
   */
  private validateTokenName(name: string): void {
    // Check for null/undefined
    if (name === null || name === undefined) {
      const error = new Error('Token name is required') as Error & { code: string };
      error.code = 'INVALID_TOKEN_NAME';
      throw error;
    }

    // Trim whitespace
    const trimmedName = name.trim();

    // Check for empty or whitespace-only names
    if (trimmedName.length === 0) {
      const error = new Error('Token name cannot be empty or whitespace only') as Error & { code: string };
      error.code = 'INVALID_TOKEN_NAME';
      throw error;
    }

    // Check length constraints
    if (trimmedName.length < TokenService.MIN_NAME_LENGTH) {
      const error = new Error(
        `Token name must be at least ${TokenService.MIN_NAME_LENGTH} character(s)`
      ) as Error & { code: string };
      error.code = 'INVALID_TOKEN_NAME';
      throw error;
    }

    if (trimmedName.length > TokenService.MAX_NAME_LENGTH) {
      const error = new Error(
        `Token name must not exceed ${TokenService.MAX_NAME_LENGTH} characters`
      ) as Error & { code: string };
      error.code = 'INVALID_TOKEN_NAME';
      throw error;
    }

    // Check for invalid characters (prevents XSS and injection attacks)
    if (!TokenService.VALID_NAME_PATTERN.test(trimmedName)) {
      const error = new Error(
        'Token name contains invalid characters. Only alphanumeric characters, spaces, hyphens, underscores, and dots are allowed'
      ) as Error & { code: string };
      error.code = 'INVALID_TOKEN_NAME';
      throw error;
    }

    // Check for dangerous patterns (additional XSS prevention)
    const dangerousPatterns = [
      /<script/i,
      /<iframe/i,
      /javascript:/i,
      /on\w+=/i, // Event handlers like onclick=
      /data:text\/html/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedName)) {
        const error = new Error(
          'Token name contains potentially dangerous content'
        ) as Error & { code: string };
        error.code = 'INVALID_TOKEN_NAME';
        throw error;
      }
    }
  }

  /**
   * Generate a secure random token
   * Format: af_live_<base62_random_string>
   */
  private generateToken(environment: 'live' | 'test' = 'live'): string {
    // Use nanoid with a custom base62 alphabet for uniform, unbiased tokens
    const base62Chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    // customAlphabet returns a function to generate base62 random string
    const nanoidBase62 = customAlphabet(base62Chars, TOKEN_LENGTH);
    const token = nanoidBase62();
    return `${TOKEN_PREFIX}_${environment}_${token}`;
  }

  /**
   * Create a new personal access token
   * Enforces rate limiting of 50 tokens per day and max 500 active tokens
   */
  async createToken(
    userId: string,
    name: string,
    expiresAt?: number,
    organizationId?: string
  ): Promise<{
    token: string;
    id: string;
    name: string;
    organizationId: string | null;
    expiresAt: number | null;
    createdAt: number;
  }> {
    // Validate token name first (before any rate limiting or database operations)
    this.validateTokenName(name);

    // Trim name for storage consistency
    const trimmedName = name.trim();

    return this.createTokenWithRetries(userId, trimmedName, expiresAt, organizationId, 0);
  }

  /**
   * Internal method to create token with retry limiting
   */
  private async createTokenWithRetries(
    userId: string,
    name: string,
    expiresAt: number | undefined,
    organizationId: string | undefined,
    retryCount: number
  ): Promise<{
    token: string;
    id: string;
    name: string;
    organizationId: string | null;
    expiresAt: number | null;
    createdAt: number;
  }> {
    // Check retry limit
    if (retryCount >= TokenService.MAX_RETRIES) {
      throw new Error('Failed to generate unique token after multiple attempts');
    }

    // Check rate limit
    const rateLimitKey = `api_key_creation:${userId}`;
    const rateLimit = await rateLimiter.checkLimit(
      rateLimitKey,
      TokenService.RATE_LIMIT,
      TokenService.RATE_LIMIT_WINDOW
    );

    if (!rateLimit.allowed) {
      // Round resetAt to nearest hour to prevent timing attacks
      const resetHour = new Date(rateLimit.resetAt);
      resetHour.setMinutes(0, 0, 0);

      const error = new Error(
        `Rate limit exceeded. You can only create ${TokenService.RATE_LIMIT} API keys per day. ` +
        `Limit resets at approximately ${resetHour.toISOString()}`
      ) as RateLimitError;
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.resetAt = resetHour; // Rounded timestamp
      throw error;
    }

    // Check max active tokens limit
    const activeTokensCount = await this.db.countPersonalAccessTokensByUserId(userId);

    if (activeTokensCount >= TokenService.MAX_ACTIVE_TOKENS) {
      const error = new Error(
        `Maximum active API keys limit reached. You can have up to ${TokenService.MAX_ACTIVE_TOKENS} active keys. ` +
        `Please delete unused keys before creating new ones.`
      ) as TokenLimitError;
      error.code = 'MAX_TOKENS_EXCEEDED';
      throw error;
    }

    // Generate token
    const token = this.generateToken();
    
    // Hash the token for storage (never store plaintext tokens)
    const tokenHash = hashToken(token);
    
    // Token prefix logged for debugging; never log the full token
    tokenServiceLogger.info('Token generated', { prefix: token.slice(0, 10) + '...' });

    // Verify token hash is unique (collision check)
    const existing = await this.db.getPersonalAccessTokenByToken(tokenHash);

    if (existing) {
      // Token collision detected - retry
      return this.createTokenWithRetries(userId, name, expiresAt, organizationId, retryCount + 1);
    }

    // Create token in database with hash (not plaintext)
    const tokenRecord = await this.db.createPersonalAccessToken({
      id: nanoid(),
      user_id: userId,
      organization_id: organizationId,
      name,
      token: tokenHash, // Store hash, not plaintext
      expires_at: expiresAt,
    });
    
    // Return plaintext token to user (only time it's available)
    return {
      token, // Return plaintext for user to save
      id: tokenRecord.id,
      name: tokenRecord.name,
      organizationId: tokenRecord.organization_id ?? null,
      expiresAt: tokenRecord.expires_at ?? null,
      createdAt: tokenRecord.created_at,
    };
  }

  /**
   * Delete a personal access token
   */
  async deleteToken(tokenId: string, userId: string): Promise<boolean> {
    const token = await this.db.getPersonalAccessTokenById(tokenId);

    if (!token) {
      throw new Error('Token not found');
    }

    if (token.user_id !== userId) {
      throw new Error('Unauthorized: Token does not belong to user');
    }

    await this.db.deletePersonalAccessToken(tokenId);

    return true;
  }

  /**
   * Validate a token and return the associated user
   * Also updates lastUsedAt timestamp
   * 
   * SECURITY: Token is hashed and looked up by hash (timing-safe)
   */
  async validateToken(token: string): Promise<{ userId: string; tokenId: string; organizationId?: string } | null> {
    // Hash the incoming token to look up the stored hash
    const tokenHash = hashToken(token);
    
    const tokenRecord = await this.db.getPersonalAccessTokenByToken(tokenHash);

    if (!tokenRecord) {
      return null;
    }

    // Check if token is expired
    if (tokenRecord.expires_at && tokenRecord.expires_at < Date.now()) {
      return null;
    }

    // Update last used timestamp (fire and forget to not block the request)
    this.db.updatePersonalAccessTokenLastUsed(tokenRecord.id)
      .catch((err) => {
        console.error('[TokenService] Error updating lastUsedAt:', err);
      });

    return {
      userId: tokenRecord.user_id,
      tokenId: tokenRecord.id,
      organizationId: tokenRecord.organization_id,
    };
  }

  /**
   * List all tokens for a user (excluding the token value itself)
   */
  async listTokens(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      organizationId: string | null;
      expiresAt: number | null;
      lastUsedAt: number | null;
      createdAt: number;
    }>
  > {
    const tokens = await this.db.listPersonalAccessTokensByUserId(userId);

    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      organizationId: t.organization_id ?? null,
      expiresAt: t.expires_at ?? null,
      lastUsedAt: t.last_used_at ?? null,
      createdAt: t.created_at,
    }));
  }

  /**
   * Get remaining rate limit for a user
   */
  async getRemainingLimit(userId: string): Promise<{
    remaining: number;
    limit: number;
    resetAt: Date;
    activeTokens: number;
    maxActiveTokens: number;
  }> {
    const rateLimitKey = `api_key_creation:${userId}`;

    // Use getCount instead of checkLimit to avoid consuming a rate limit slot
    const currentCount = await rateLimiter.getCount(rateLimitKey);
    const remaining = Math.max(0, TokenService.RATE_LIMIT - currentCount);

    // Calculate reset time
    const now = Date.now();
    const resetAt = new Date(now + TokenService.RATE_LIMIT_WINDOW * 1000);

    const activeTokensCount = await this.db.countPersonalAccessTokensByUserId(userId);

    return {
      remaining,
      limit: TokenService.RATE_LIMIT,
      resetAt,
      activeTokens: activeTokensCount,
      maxActiveTokens: TokenService.MAX_ACTIVE_TOKENS,
    };
  }

  /**
   * Clean up expired tokens
   * Returns count of deleted tokens
   * Should be run periodically (e.g., daily via cron job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const deletedCount = await this.db.deleteExpiredPersonalAccessTokens();

      if (deletedCount > 0) {
        tokenServiceLogger.info('Cleaned up expired tokens', {
          operation: 'cleanup',
          deletedCount,
        });
      }

      return deletedCount;
    } catch (error) {
      tokenServiceLogger.error('Error cleaning up expired tokens', {
        operation: 'cleanup',
      }, error as Error);
      throw error;
    }
  }
}
