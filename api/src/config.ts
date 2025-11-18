import 'dotenv/config';

function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const appConfig = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  qrSecret: getEnv('QR_SECRET', 'ticketdrop-secret-key-change-in-production'),
  waitingRoom: {
    tokenTtlSeconds: parseInt(process.env.WAITING_ROOM_TOKEN_TTL ?? '3600', 10), // 1 hour
    accessTtlSeconds: parseInt(process.env.WAITING_ROOM_ACCESS_TTL ?? '180', 10), // 3 minutes
    waveSize: parseInt(process.env.WAITING_ROOM_WAVE_SIZE ?? '100', 10),
    waveAdvanceIntervalMs: parseInt(process.env.WAITING_ROOM_WAVE_INTERVAL_MS ?? `${30_000}`, 10),
  },
  reservation: {
    ttlMinutes: parseInt(process.env.RESERVATION_TTL_MINUTES ?? '3', 10),
    perEventLimit: parseInt(process.env.EVENT_PURCHASE_LIMIT ?? '6', 10),
  },
  worker: {
    intervalMs: parseInt(process.env.EXPIRATION_WORKER_INTERVAL_MS ?? `${60_000}`, 10),
  },
};


