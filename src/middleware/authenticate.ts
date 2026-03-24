import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { verifyApiKey } from '../utils/hash';
import { ApiError } from './errorHandler';

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'MISSING_API_KEY', 'Authorization header is required. Format: Bearer <api_key>');
  }

  const rawKey = authHeader.substring(7);

  if (!rawKey.startsWith('vz_')) {
    throw new ApiError(401, 'INVALID_API_KEY', 'Invalid API key format');
  }

  // Get all active keys for this prefix pattern - we check hash to find the right one
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      tenant: true,
      user: true,
    },
  });

  // Find matching key by verifying hash
  let matchedKey = null;
  for (const key of apiKeys) {
    const isValid = await verifyApiKey(rawKey, key.keyHash);
    if (isValid) {
      matchedKey = key;
      break;
    }
  }

  if (!matchedKey) {
    throw new ApiError(401, 'INVALID_API_KEY', 'API key is invalid or expired');
  }

  req.tenant = matchedKey.tenant;
  req.user = matchedKey.user;
  req.apiKey = matchedKey;

  next();
}