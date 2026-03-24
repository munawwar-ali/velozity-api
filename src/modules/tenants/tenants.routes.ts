import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requireOwner } from '../../middleware/authorize';
import { createAuditLog } from '../../utils/audit';
import { z } from 'zod';
import { ApiError } from '../../middleware/errorHandler';

const router = Router();

// GET /tenants/me — Get current tenant info
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenant.id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: { users: true, apiKeys: true },
      },
    },
  });

  res.json({ data: tenant });
});

// PATCH /tenants/me — Update tenant name (Owner only)
router.patch('/me', authenticate, requireOwner, async (req: Request, res: Response) => {
  const schema = z.object({
    name: z.string().min(1).max(100),
  });

  const body = schema.parse(req.body);

  const previous = await prisma.tenant.findUnique({
    where: { id: req.tenant.id },
  });

  if (!previous) {
    throw new ApiError(404, 'NOT_FOUND', 'Tenant not found');
  }

  const updated = await prisma.tenant.update({
    where: { id: req.tenant.id },
    data: { name: body.name },
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: req.apiKey.id,
    action: 'TENANT_UPDATED',
    resourceType: 'tenant',
    resourceId: req.tenant.id,
    previousValue: { name: previous.name },
    newValue: { name: updated.name },
    ipAddress: req.ip,
  });

  res.json({ data: updated });
});

export default router;