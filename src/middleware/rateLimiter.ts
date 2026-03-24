import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { ApiError } from './errorHandler';
import { addEmailJob } from '../queues/emailQueue';
import { prisma } from '../config/prisma';

// Sliding window rate limiter using Redis sorted sets
async function slidingWindowCheck(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number; resetIn: number }> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const multi = redis.multi();

  // Remove entries outside the window
  multi.zremrangebyscore(key, '-inf', windowStart);
  // Count entries in current window
  multi.zcard(key);
  // Add current request
  multi.zadd(key, now, `${now}-${Math.random()}`);
  // Set expiry on the key
  multi.expire(key, windowSeconds);

  const results = await multi.exec();

  const count = (results?.[1]?.[1] as number) ?? 0;
  const resetIn = windowSeconds;

  if (count >= limit) {
    // Remove the entry we just added since request is rejected
    await redis.zremrangebyscore(key, now, now);
    return { allowed: false, count, resetIn };
  }

  return { allowed: true, count: count + 1, resetIn };
}

// Endpoint-level rate limit config
const endpointLimits: Record<string, number> = {
  'POST /users': 50,
  'POST /auth/rotate': 10,
  'GET /audit': 100,
  'GET /metrics': 30,
};

function getEndpointLimit(method: string, path: string): number {
  const normalizedPath = path.replace(/\/[a-f0-9-]{36}/g, '/:id');
  const key = `${method} ${normalizedPath}`;
  return endpointLimits[key] ?? 200;
}

export async function rateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const tenantId = req.tenant.id;
  const apiKeyId = req.apiKey.id;
  const method = req.method;
  const path = req.path;

  // --- TIER 1: Global (1000 req/min per tenant) ---
  const globalKey = `rl:global:${tenantId}`;
  const globalLimit = 1000;
  const globalWindow = 60;

  const globalResult = await slidingWindowCheck(globalKey, globalLimit, globalWindow);

  if (!globalResult.allowed) {
    res.setHeader('X-RateLimit-Limit', globalLimit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', globalResult.resetIn);

    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', {
      tier: 'global',
      limit: globalLimit,
      count: globalResult.count,
      resetInSeconds: globalResult.resetIn,
    });
  }

  // Check 80% threshold for warning email (once per hour max)
  if (globalResult.count >= globalLimit * 0.8) {
    await sendRateLimitWarning(tenantId);
  }

  // --- TIER 2: Endpoint (configurable per route per tenant) ---
  const endpointLimit = getEndpointLimit(method, path);
  const endpointKey = `rl:endpoint:${tenantId}:${method}:${path}`;
  const endpointWindow = 60;

  const endpointResult = await slidingWindowCheck(endpointKey, endpointLimit, endpointWindow);

  if (!endpointResult.allowed) {
    res.setHeader('X-RateLimit-Limit', endpointLimit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', endpointResult.resetIn);

    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Endpoint rate limit exceeded', {
      tier: 'endpoint',
      endpoint: `${method} ${path}`,
      limit: endpointLimit,
      count: endpointResult.count,
      resetInSeconds: endpointResult.resetIn,
    });
  }

  // --- TIER 3: Burst (50 req per 5 seconds per API key) ---
  const burstKey = `rl:burst:${apiKeyId}`;
  const burstLimit = 50;
  const burstWindow = 5;

  const burstResult = await slidingWindowCheck(burstKey, burstLimit, burstWindow);

  if (!burstResult.allowed) {
    res.setHeader('X-RateLimit-Limit', burstLimit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', burstResult.resetIn);

    throw new ApiError(429, 'RATE_LIMIT_EXCEEDED', 'Burst rate limit exceeded', {
      tier: 'burst',
      limit: burstLimit,
      count: burstResult.count,
      resetInSeconds: burstResult.resetIn,
    });
  }

  // Attach rate limit headers to every response
  res.setHeader('X-RateLimit-Limit', globalLimit);
  res.setHeader('X-RateLimit-Remaining', globalLimit - globalResult.count);
  res.setHeader('X-RateLimit-Reset', globalResult.resetIn);

  next();
}

async function sendRateLimitWarning(tenantId: string): Promise<void> {
  try {
    // Max one warning email per hour per tenant
    const warningKey = `rl:warning:${tenantId}`;
    const alreadySent = await redis.get(warningKey);
    if (alreadySent) return;

    // Set 1-hour lock
    await redis.setex(warningKey, 3600, '1');

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: { where: { role: 'OWNER' } },
      },
    });

    if (!tenant || tenant.users.length === 0) return;

    const owner = tenant.users[0];

    await addEmailJob({
      type: 'RATE_LIMIT_WARNING',
      tenantId,
      recipient: owner.email,
      data: {
        tenantName: tenant.name,
        ownerName: owner.name,
        threshold: '80%',
      },
    });
  } catch {
    // Non-critical — don't fail the request if warning email fails
  }
}