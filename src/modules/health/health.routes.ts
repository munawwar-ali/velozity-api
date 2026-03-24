import { Router, Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { redis } from '../../config/redis';
import { emailQueue } from '../../queues/emailQueue';
import { env } from '../../config/env';
import { ApiError } from '../../middleware/errorHandler';

const router = Router();

// Track response times for last 60 seconds
const responseTimes: { time: number; duration: number }[] = [];

export function recordResponseTime(duration: number): void {
  const now = Date.now();
  responseTimes.push({ time: now, duration });

  // Keep only last 60 seconds
  const cutoff = now - 60 * 1000;
  while (responseTimes.length > 0 && responseTimes[0].time < cutoff) {
    responseTimes.shift();
  }
}

export function getAverageResponseTime(): number {
  if (responseTimes.length === 0) return 0;
  const sum = responseTimes.reduce((acc, r) => acc + r.duration, 0);
  return Math.round(sum / responseTimes.length);
}

// Internal API key middleware
function requireInternalKey(req: Request, res: Response, next: Function): void {
  const key = req.headers['x-internal-key'];
  if (!key || key !== env.INTERNAL_API_KEY) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Valid internal API key required');
  }
  next();
}

// GET /health
router.get('/', requireInternalKey, async (req: Request, res: Response) => {
  const checks = await Promise.allSettled([
    // DB check
    prisma.$queryRaw`SELECT 1`,
    // Redis check
    redis.ping(),
    // Queue depth
    Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getFailedCount(),
    ]),
  ]);

  const dbStatus = checks[0].status === 'fulfilled' ? 'healthy' : 'unhealthy';
  const redisStatus = checks[1].status === 'fulfilled' ? 'healthy' : 'unhealthy';

  let queueDepth = { pending: 0, failed: 0 };
  if (checks[2].status === 'fulfilled') {
    const [pending, failed] = checks[2].value as [number, number];
    queueDepth = { pending, failed };
  }

  const avgResponseTime = getAverageResponseTime();
  const isHealthy = dbStatus === 'healthy' && redisStatus === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    data: {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        database: dbStatus,
        redis: redisStatus,
      },
      queue: queueDepth,
      performance: {
        avgResponseTimeMs: avgResponseTime,
        windowSeconds: 60,
      },
    },
  });
});

export { requireInternalKey };
export default router;