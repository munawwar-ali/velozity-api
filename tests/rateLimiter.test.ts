import Redis from 'ioredis';

const redis = new Redis('redis://localhost:6379');

async function slidingWindowCheck(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; count: number }> {
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const multi = redis.multi();
  multi.zremrangebyscore(key, '-inf', windowStart);
  multi.zcard(key);
  multi.zadd(key, now, `${now}-${Math.random()}`);
  multi.expire(key, windowSeconds);

  const results = await multi.exec();
  const count = (results?.[1]?.[1] as number) ?? 0;

  if (count >= limit) {
    await redis.zremrangebyscore(key, now, now);
    return { allowed: false, count };
  }

  return { allowed: true, count: count + 1 };
}

describe('Sliding Window Rate Limiter', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('allows requests within the limit', async () => {
    const key = 'test:sliding:basic';
    const limit = 5;

    for (let i = 0; i < limit; i++) {
      const result = await slidingWindowCheck(key, limit, 60);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests exceeding the limit', async () => {
    const key = 'test:sliding:block';
    const limit = 3;

    for (let i = 0; i < limit; i++) {
      await slidingWindowCheck(key, limit, 60);
    }

    const result = await slidingWindowCheck(key, limit, 60);
    expect(result.allowed).toBe(false);
  });

  it('sliding window allows requests after window passes', async () => {
    const key = 'test:sliding:window';
    const limit = 2;
    const windowSeconds = 1; // 1 second window for testing

    // Fill the limit
    await slidingWindowCheck(key, limit, windowSeconds);
    await slidingWindowCheck(key, limit, windowSeconds);

    // Should be blocked
    const blocked = await slidingWindowCheck(key, limit, windowSeconds);
    expect(blocked.allowed).toBe(false);

    // Wait for window to pass
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should be allowed again
    const allowed = await slidingWindowCheck(key, limit, windowSeconds);
    expect(allowed.allowed).toBe(true);
  });

  it('correctly handles boundary requests in sliding window', async () => {
    const key = 'test:sliding:boundary';
    const limit = 5;
    const windowSeconds = 2;

    // Send 5 requests
    for (let i = 0; i < limit; i++) {
      const result = await slidingWindowCheck(key, limit, windowSeconds);
      expect(result.allowed).toBe(true);
    }

    // 6th request should be blocked
    const blocked = await slidingWindowCheck(key, limit, windowSeconds);
    expect(blocked.allowed).toBe(false);

    // Wait half the window — should still be blocked (sliding, not fixed)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stillBlocked = await slidingWindowCheck(key, limit, windowSeconds);
    expect(stillBlocked.allowed).toBe(false);

    // Wait for full window to pass
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const nowAllowed = await slidingWindowCheck(key, limit, windowSeconds);
    expect(nowAllowed.allowed).toBe(true);
  });

  it('tracks count correctly', async () => {
    const key = 'test:sliding:count';
    const limit = 10;

    const result1 = await slidingWindowCheck(key, limit, 60);
    expect(result1.count).toBe(1);

    const result2 = await slidingWindowCheck(key, limit, 60);
    expect(result2.count).toBe(2);

    const result3 = await slidingWindowCheck(key, limit, 60);
    expect(result3.count).toBe(3);
  });

  it('different keys are isolated', async () => {
    const limit = 2;

    await slidingWindowCheck('test:key1', limit, 60);
    await slidingWindowCheck('test:key1', limit, 60);

    // key1 should be blocked
    const blocked = await slidingWindowCheck('test:key1', limit, 60);
    expect(blocked.allowed).toBe(false);

    // key2 should still be allowed
    const allowed = await slidingWindowCheck('test:key2', limit, 60);
    expect(allowed.allowed).toBe(true);
  });
});