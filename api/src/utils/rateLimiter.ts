import redis from '../redis';

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  try {
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
  } catch (error: any) {
    // If Redis is unavailable, allow the request (fail open)
    // This prevents Redis outages from breaking the entire application
    console.error('Rate limit error (allowing request):', {
      key,
      error: error.message,
      code: error.code,
    });
    return {
      allowed: true,
      remaining: limit,
    };
  }
}


