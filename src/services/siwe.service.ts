/**
 * Sign-In with Ethereum (SIWE) service
 * Implements EIP-4361: Sign-In with Ethereum
 */

import { verifyMessage } from 'ethers';

export interface SIWEMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

export class SIWEService {
  /**
   * Create a SIWE message string (EIP-4361 format)
   */
  createMessage(params: SIWEMessage): string {
    const {
      domain,
      address,
      statement,
      uri,
      version,
      chainId,
      nonce,
      issuedAt,
      expirationTime,
      notBefore,
      requestId,
      resources,
    } = params;

    let message = `${domain} wants you to sign in with your Ethereum account:\n`;
    message += `${address}\n\n`;

    if (statement) {
      message += `${statement}\n\n`;
    }

    message += `URI: ${uri}\n`;
    message += `Version: ${version}\n`;
    message += `Chain ID: ${chainId}\n`;
    message += `Nonce: ${nonce}\n`;
    message += `Issued At: ${issuedAt}`;

    if (expirationTime) {
      message += `\nExpiration Time: ${expirationTime}`;
    }

    if (notBefore) {
      message += `\nNot Before: ${notBefore}`;
    }

    if (requestId) {
      message += `\nRequest ID: ${requestId}`;
    }

    if (resources && resources.length > 0) {
      message += `\nResources:`;
      resources.forEach((resource) => {
        message += `\n- ${resource}`;
      });
    }

    return message;
  }

  /**
   * Verify an Ethereum signature
   */
  verifySignature(message: string, signature: string, address: string): boolean {
    try {
      // Use ethers to recover the signer address from the signature
      const recoveredAddress = verifyMessage(message, signature);

      // Compare addresses (case-insensitive)
      return recoveredAddress.toLowerCase() === address.toLowerCase();
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }
}

export const siweService = new SIWEService();
