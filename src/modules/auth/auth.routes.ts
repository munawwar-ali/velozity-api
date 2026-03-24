import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { generateApiKey, hashApiKey } from '../../utils/hash';
import { authenticate } from '../../middleware/authenticate';
import { requireOwner } from '../../middleware/authorize';
import { createAuditLog } from '../../utils/audit';
import { addEmailJob } from '../../queues/emailQueue';
import { ApiError } from '../../middleware/errorHandler';
import { z } from 'zod';

const router = Router();

// POST /auth/keys — Create a new API key (Owner only)
router.post('/keys', authenticate, requireOwner, async (req: Request, res: Response) => {
  const { raw, prefix } = generateApiKey();
  const keyHash = await hashApiKey(raw);

  const apiKey = await prisma.apiKey.create({
    data: {
      keyHash,
      prefix,
      tenantId: req.tenant.id,
      userId: req.user.id,
    },
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: apiKey.id,
    action: 'API_KEY_CREATED',
    resourceType: 'api_key',
    resourceId: apiKey.id,
    newValue: { prefix, userId: req.user.id },
    ipAddress: req.ip,
  });

  res.status(201).json({
    data: {
      id: apiKey.id,
      key: raw, // Raw key shown ONCE only
      prefix,
      createdAt: apiKey.createdAt,
      message: 'Store this key securely. It will never be shown again.',
    },
  });
});

// POST /auth/rotate — Rotate API key (Owner only)
router.post('/rotate', authenticate, requireOwner, async (req: Request, res: Response) => {
  const currentKey = req.apiKey;

  // Generate new key
  const { raw, prefix } = generateApiKey();
  const keyHash = await hashApiKey(raw);

  // Create new key
  const newApiKey = await prisma.apiKey.create({
    data: {
      keyHash,
      prefix,
      tenantId: req.tenant.id,
      userId: req.user.id,
    },
  });

  // Old key expires in exactly 15 minutes
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.apiKey.update({
    where: { id: currentKey.id },
    data: {
      expiresAt,
      rotatedAt: new Date(),
    },
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: newApiKey.id,
    action: 'API_KEY_ROTATED',
    resourceType: 'api_key',
    resourceId: currentKey.id,
    previousValue: { keyId: currentKey.id },
    newValue: { newKeyId: newApiKey.id, oldKeyExpiresAt: expiresAt },
    ipAddress: req.ip,
  });

  // Create email log entry
  const emailLog = await prisma.emailLog.create({
    data: {
      tenantId: req.tenant.id,
      recipient: req.user.email,
      template: 'API_KEY_ROTATED',
      status: 'PENDING',
    },
  });

  // Queue notification email
  await addEmailJob({
    type: 'API_KEY_ROTATED',
    tenantId: req.tenant.id,
    recipient: req.user.email,
    emailLogId: emailLog.id,
    data: {
      tenantName: req.tenant.name,
      ownerName: req.user.name,
    },
  });

  res.status(200).json({
    data: {
      newKey: raw, // Raw key shown ONCE only
      prefix,
      oldKeyExpiresAt: expiresAt,
      message: 'Old key valid for 15 minutes. Store new key securely.',
    },
  });
});

// GET /auth/keys — List all API keys for tenant (Owner only)
router.get('/keys', authenticate, requireOwner, async (req: Request, res: Response) => {
  const keys = await prisma.apiKey.findMany({
    where: { tenantId: req.tenant.id },
    select: {
      id: true,
      prefix: true,
      isActive: true,
      expiresAt: true,
      createdAt: true,
      rotatedAt: true,
      userId: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: keys });
});

// DELETE /auth/keys/:id — Revoke an API key (Owner only)
router.delete('/keys/:id', authenticate, requireOwner, async (req: Request, res: Response) => {
  const { id } = req.params;

  const key = await prisma.apiKey.findFirst({
    where: { id, tenantId: req.tenant.id },
  });

  if (!key) {
    throw new ApiError(404, 'NOT_FOUND', 'API key not found');
  }

  await prisma.apiKey.update({
    where: { id },
    data: { isActive: false },
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: req.apiKey.id,
    action: 'API_KEY_REVOKED',
    resourceType: 'api_key',
    resourceId: id,
    previousValue: { isActive: true },
    newValue: { isActive: false },
    ipAddress: req.ip,
  });

  res.json({ data: { message: 'API key revoked successfully' } });
});

export default router;