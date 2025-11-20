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
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
  // Don't crash the app if Redis fails - log and continue
});

redis.on('connect', () => {
  console.log('Redis Client Connected');
});

export default redis;

