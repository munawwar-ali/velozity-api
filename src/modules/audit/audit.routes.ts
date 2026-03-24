import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { computeChainHash, GENESIS_HASH } from '../../utils/chainHash';
import { ApiError } from '../../middleware/errorHandler';

const router = Router();

// GET /audit — Query audit logs with filters + cursor pagination
router.get('/', authenticate, async (req: Request, res: Response) => {
  const {
    userId,
    action,
    resourceType,
    from,
    to,
    cursor,
    limit = '20',
  } = req.query;

  const take = Math.min(parseInt(limit as string), 100);

  const where: Record<string, unknown> = {
    tenantId: req.tenant.id,
  };

  if (userId) where.userId = userId as string;
  if (action) where.action = action as string;
  if (resourceType) where.resourceType = resourceType as string;

  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from as string) } : {}),
      ...(to ? { lte: new Date(to as string) } : {}),
    };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
    orderBy: { sequence: 'desc' },
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      userId: true,
      apiKeyId: true,
      previousValue: true,
      newValue: true,
      ipAddress: true,
      chainHash: true,
      sequence: true,
      createdAt: true,
    },
  });

  const hasNextPage = logs.length > take;
  const results = hasNextPage ? logs.slice(0, -1) : logs;
  const nextCursor = hasNextPage ? results[results.length - 1].id : null;

  res.json({
    data: results,
    pagination: {
      nextCursor,
      hasNextPage,
      limit: take,
    },
  });
});

// GET /audit/verify — Verify the entire audit chain integrity
router.get('/verify', authenticate, async (req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { sequence: 'asc' },
  });

  if (logs.length === 0) {
    res.json({
      data: {
        intact: true,
        message: 'No audit logs found',
        totalEntries: 0,
      },
    });
    return;
  }

  let previousHash = GENESIS_HASH;
  let tamperedEntry = null;

  for (const log of logs) {
    const entryContent = {
      tenantId: log.tenantId,
      userId: log.userId,
      apiKeyId: log.apiKeyId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      previousValue: log.previousValue,
      newValue: log.newValue,
      ipAddress: log.ipAddress,
      sequence: log.sequence,
    };

    const expectedHash = computeChainHash(entryContent, previousHash);

    if (expectedHash !== log.chainHash) {
      tamperedEntry = {
        id: log.id,
        sequence: log.sequence,
        action: log.action,
        createdAt: log.createdAt,
      };
      break;
    }

    previousHash = log.chainHash;
  }

  if (tamperedEntry) {
    res.status(200).json({
      data: {
        intact: false,
        message: 'Audit chain has been tampered with',
        tamperedEntry,
        totalEntries: logs.length,
      },
    });
    return;
  }

  res.json({
    data: {
      intact: true,
      message: 'Audit chain is intact',
      totalEntries: logs.length,
      lastHash: previousHash,
    },
  });
});

export default router;