import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class WhitelistService {
  isEnabled(): boolean {
    const val = process.env.WHITELIST_ENABLED;
    // Enabled by default when the var is unset or explicitly 'true'
    return val === undefined || val === '' || val === 'true' || val === '1';
  }

  async isWhitelisted(identifier: string): Promise<boolean> {
    const entry = await prisma.authWhitelist.findUnique({
      where: { identifier: identifier.toLowerCase() },
    });
    return !!entry;
  }

  /**
   * Throws 403 if the whitelist is enabled and the identifier is not on it.
   * Call this in every auth verify route before issuing tokens.
   */
  /**
   * Returns null if allowed, or a structured error response if blocked.
   * Callers should check the return value and send it as a JSON response.
   */
  async check403(identifier: string): Promise<{ blocked: true; body: object; status: 403 } | null> {
    if (!this.isEnabled()) return null;

    const allowed = await this.isWhitelisted(identifier);
    if (!allowed) {
      return {
        blocked: true,
        status: 403,
        body: {
          error: 'access_restricted',
          message: 'Alternate Clouds is currently in early access. You\'ll need an invite to sign in.',
        },
      };
    }
    return null;
  }

  async list() {
    return prisma.authWhitelist.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async add(identifier: string, identifierType: string, note?: string) {
    return prisma.authWhitelist.upsert({
      where: { identifier: identifier.toLowerCase() },
      update: { note, identifierType },
      create: {
        identifier: identifier.toLowerCase(),
        identifierType,
        note,
      },
    });
  }

  async remove(id: string) {
    return prisma.authWhitelist.delete({ where: { id } });
  }

  async check(identifier: string) {
    return prisma.authWhitelist.findUnique({
      where: { identifier: identifier.toLowerCase() },
    });
  }
}

export const whitelistService = new WhitelistService();
