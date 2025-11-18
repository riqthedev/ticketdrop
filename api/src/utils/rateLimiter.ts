import redis from '../redis';

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const namespacedKey = `rate_limit:${key}`;
  const count = await redis.incr(namespacedKey);

  if (count === 1) {
    await redis.expire(namespacedKey, windowSeconds);
  }

  if (count > limit) {
    const ttl = await redis.ttl(namespacedKey);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
  };
}


