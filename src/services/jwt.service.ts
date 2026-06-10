import jwt, { type SignOptions } from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { secretsService } from './secrets.service';

export interface TokenPayload {
  userId: string;
  email?: string;
  sessionId: string;
  type: 'access' | 'refresh';
}

export interface JWTConfig {
  accessTokenExpiry: string;
  refreshTokenExpiry: string;
}

export class JWTService {
  private expiryConfig: JWTConfig;

  constructor(config: JWTConfig) {
    this.expiryConfig = config;
  }

  private get accessTokenSecret(): string {
    const secret = secretsService.get('JWT_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_SECRET is not set. Refusing to start in production without a proper secret.');
      }
      return 'development-secret';
    }
    return secret;
  }

  private get refreshTokenSecret(): string {
    const secret = secretsService.get('JWT_REFRESH_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL: JWT_REFRESH_SECRET is not set. Refusing to start in production without a proper secret.');
      }
      return 'development-refresh-secret';
    }
    return secret;
  }

  /**
   * Generate an access token (short-lived)
   */
  generateAccessToken(userId: string, email?: string): string {
    return this.generateAccessTokenForSession(userId, nanoid(), email);
  }

  /**
   * Generate a refresh token (long-lived)
   */
  generateRefreshToken(userId: string, sessionId: string): string {
    const payload: TokenPayload = {
      userId,
      sessionId,
      type: 'refresh',
    };

    return jwt.sign(payload, this.refreshTokenSecret, {
      expiresIn: this.expiryConfig.refreshTokenExpiry as string,
      issuer: 'alternatefutures-auth',
      audience: 'alternatefutures-app',
    } as SignOptions);
  }

  /**
   * Generate both access and refresh tokens
   */
  generateTokenPair(userId: string, email?: string): {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  } {
    const sessionId = nanoid();

    const accessToken = this.generateAccessTokenForSession(userId, sessionId, email);

    const refreshToken = jwt.sign(
      {
        userId,
        sessionId,
        type: 'refresh',
      } as TokenPayload,
      this.refreshTokenSecret,
      {
        expiresIn: this.expiryConfig.refreshTokenExpiry as string,
        issuer: 'alternatefutures-auth',
        audience: 'alternatefutures-app',
      } as SignOptions
    );

    return {
      accessToken,
      refreshToken,
      sessionId,
    };
  }

  /**
   * Generate an access token for an existing session
   * (used when refreshing tokens so sessionId remains stable)
   */
  generateAccessTokenForSession(userId: string, sessionId: string, email?: string): string {
    const payload: TokenPayload = {
      userId,
      email,
      sessionId,
      type: 'access',
    };

    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.expiryConfig.accessTokenExpiry as string,
      issuer: 'alternatefutures-auth',
      audience: 'alternatefutures-app',
    } as SignOptions);
  }

  /**
   * Verify an access token
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      // First decode without verification to check token type
      const unverified = jwt.decode(token) as TokenPayload | null;

      if (!unverified) {
        throw new Error('Invalid access token');
      }

      if (unverified.type !== 'access') {
        throw new Error('Invalid token type');
      }

      // Now verify with correct secret. Pin HS256 explicitly (algorithm
      // confusion defense) and allow small clock skew between pods (W2-19).
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'alternatefutures-auth',
        audience: 'alternatefutures-app',
        algorithms: ['HS256'],
        clockTolerance: 5,
      }) as TokenPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Access token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid access token');
      }
      throw error;
    }
  }

  /**
   * Verify a refresh token
   */
  verifyRefreshToken(token: string): TokenPayload {
    try {
      // First decode without verification to check token type
      const unverified = jwt.decode(token) as TokenPayload | null;

      if (!unverified) {
        throw new Error('Invalid refresh token');
      }

      if (unverified.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Now verify with correct secret. HS256 pinned + small clock skew
      // tolerance (W2-19).
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'alternatefutures-auth',
        audience: 'alternatefutures-app',
        algorithms: ['HS256'],
        clockTolerance: 5,
      }) as TokenPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Decode a token without verification (useful for debugging)
   */
  decode(token: string): TokenPayload | null {
    const decoded = jwt.decode(token);
    return decoded as TokenPayload | null;
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token: string): Date | null {
    const decoded = this.decode(token);
    if (!decoded || !('exp' in decoded)) {
      return null;
    }
    return new Date((decoded as any).exp * 1000);
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: string): boolean {
    const expiration = this.getTokenExpiration(token);
    if (!expiration) {
      return true;
    }
    return expiration < new Date();
  }
}

// Create singleton instance
// Secrets are loaded from secretsService at runtime
export const jwtService = new JWTService({
  accessTokenExpiry: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
});
