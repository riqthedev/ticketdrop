import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // Add connection timeout for serverless
  connectTimeout: 5000,
  lazyConnect: true, // Don't connect immediately - connect on first use
  // Enable offline queue to prevent errors when Redis is unavailable
  enableOfflineQueue: false, // Fail fast instead of queuing
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', {
    message: err.message,
    code: (err as any).code,
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || '6379',
  });
  // Don't crash the app if Redis fails - log and continue
});

redis.on('connect', () => {
  console.log('Redis Client Connected');
});

// Helper function to safely execute Redis commands with error handling
export async function safeRedisOperation<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Log connection errors for debugging
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message?.includes('Connection')) {
      console.error('Redis connection error:', {
        code: error.code,
        message: error.message,
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || '6379',
      });
    }
    
    // Return fallback value if provided, otherwise rethrow
    if (fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

export default redis;

