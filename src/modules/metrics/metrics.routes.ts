import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { requireInternalKey } from '../health/health.routes';

const router = Router();

// GET /metrics — Per-tenant usage stats
router.get('/', requireInternalKey, async (req: Request, res: Response) => {
  const { tenantId } = req.query;

  // Billing period = current calendar month
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const tenantFilter = tenantId
    ? { id: tenantId as string }
    : {};

  const tenants = await prisma.tenant.findMany({
    where: tenantFilter,
    select: { id: true, name: true },
  });

  const metrics = await Promise.all(
    tenants.map(async (tenant) => {
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        select: {
          action: true,
          resourceType: true,
          createdAt: true,
        },
      });

      // Count requests by resource type
      const requestsByEndpoint: Record<string, number> = {};
      for (const log of auditLogs) {
        const key = log.resourceType;
        requestsByEndpoint[key] = (requestsByEndpoint[key] ?? 0) + 1;
      }

      // Rate limit breach count
      const rateLimitBreaches = auditLogs.filter(
        (l) => l.action === 'RATE_LIMIT_EXCEEDED'
      ).length;

      // Email delivery stats
      const emailLogs = await prisma.emailLog.findMany({
        where: {
          tenantId: tenant.id,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        select: { status: true },
      });

      const totalEmails = emailLogs.length;
      const sentEmails = emailLogs.filter((e) => e.status === 'SENT').length;
      const emailSuccessRate =
        totalEmails > 0
          ? Math.round((sentEmails / totalEmails) * 100)
          : 100;

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        billingPeriod: {
          from: periodStart.toISOString(),
          to: periodEnd.toISOString(),
        },
        totalRequests: auditLogs.length,
        requestsByEndpoint,
        rateLimitBreaches,
        email: {
          total: totalEmails,
          sent: sentEmails,
          successRate: `${emailSuccessRate}%`,
        },
      };
    })
  );

  res.json({ data: metrics });
});

export default router;