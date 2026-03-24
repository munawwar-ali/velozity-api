import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { requireOwner } from '../../middleware/authorize';
import { createAuditLog } from '../../utils/audit';
import { addEmailJob } from '../../queues/emailQueue';
import { ApiError } from '../../middleware/errorHandler';
import { z } from 'zod';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
});

// GET /users — List all users in tenant
router.get('/', authenticate, async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.tenant.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({ data: users });
});

// GET /users/:id — Get single user (must belong to same tenant)
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const user = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.tenant.id, // Tenant isolation enforced at query level
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  res.json({ data: user });
});

// POST /users — Invite user to tenant (Owner only)
router.post('/', authenticate, requireOwner, async (req: Request, res: Response) => {
  const body = createUserSchema.parse(req.body);

  // Check if user already exists in this tenant
  const existing = await prisma.user.findFirst({
    where: {
      email: body.email,
      tenantId: req.tenant.id,
    },
  });

  if (existing) {
    throw new ApiError(409, 'CONFLICT', 'User with this email already exists in this tenant');
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      role: body.role,
      tenantId: req.tenant.id,
    },
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: req.apiKey.id,
    action: 'USER_CREATED',
    resourceType: 'user',
    resourceId: user.id,
    newValue: { email: user.email, name: user.name, role: user.role },
    ipAddress: req.ip,
  });

  // Create email log
  const emailLog = await prisma.emailLog.create({
    data: {
      tenantId: req.tenant.id,
      recipient: user.email,
      template: 'USER_INVITED',
      status: 'PENDING',
    },
  });

  // Queue invitation email
  await addEmailJob({
    type: 'USER_INVITED',
    tenantId: req.tenant.id,
    recipient: user.email,
    emailLogId: emailLog.id,
    data: {
      tenantName: req.tenant.name,
      recipientName: user.name,
      email: user.email,
      role: user.role,
    },
  });

  res.status(201).json({ data: user });
});

// PATCH /users/:id — Update user (Owner only)
router.patch('/:id', authenticate, requireOwner, async (req: Request, res: Response) => {
  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    role: z.enum(['OWNER', 'MEMBER']).optional(),
  });

  const body = updateSchema.parse(req.body);

  const existing = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.tenant.id, // Tenant isolation enforced at query level
    },
  });

  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: body,
  });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: req.apiKey.id,
    action: 'USER_UPDATED',
    resourceType: 'user',
    resourceId: updated.id,
    previousValue: { name: existing.name, role: existing.role },
    newValue: { name: updated.name, role: updated.role },
    ipAddress: req.ip,
  });

  res.json({ data: updated });
});

// DELETE /users/:id — Remove user (Owner only)
router.delete('/:id', authenticate, requireOwner, async (req: Request, res: Response) => {
  const existing = await prisma.user.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.tenant.id, // Tenant isolation enforced at query level
    },
  });

  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'User not found');
  }

  if (existing.id === req.user.id) {
    throw new ApiError(400, 'BAD_REQUEST', 'You cannot delete your own account');
  }

  await prisma.user.delete({ where: { id: req.params.id } });

  await createAuditLog({
    tenantId: req.tenant.id,
    userId: req.user.id,
    apiKeyId: req.apiKey.id,
    action: 'USER_DELETED',
    resourceType: 'user',
    resourceId: existing.id,
    previousValue: { email: existing.email, name: existing.name, role: existing.role },
    ipAddress: req.ip,
  });

  res.json({ data: { message: 'User deleted successfully' } });
});

export default router;