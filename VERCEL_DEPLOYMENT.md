# Vercel Deployment Guide

This document outlines the requirements and configuration for deploying this TicketMaster clone to Vercel.

## Project Structure

- **Frontend**: React + Vite app in `/web` directory
- **Backend**: Express.js API in `/src` directory, exposed via `/api/index.ts`
- **Database**: PostgreSQL (external service required)
- **Cache**: Redis (external service required)

## Environment Variables

### Required Environment Variables

Set these in your Vercel project settings (Settings → Environment Variables):

#### Database Configuration
```
DB_HOST=your-postgres-host
DB_PORT=5432
DB_USER=your-postgres-user
DB_PASSWORD=your-postgres-password
DB_NAME=your-database-name
```

#### Redis Configuration
```
REDIS_HOST=your-redis-host
REDIS_PORT=6379
# OR use Redis URL format:
# REDIS_URL=redis://your-redis-host:6379
```

#### Application Configuration
```
QR_SECRET=your-secret-key-for-qr-code-signatures
```

### Optional Environment Variables

These have defaults but can be customized:

```
# Waiting Room Configuration
WAITING_ROOM_TOKEN_TTL=3600          # Token TTL in seconds (default: 1 hour)
WAITING_ROOM_ACCESS_TTL=180          # Access TTL in seconds (default: 3 minutes)
WAITING_ROOM_WAVE_SIZE=100           # Users per wave (default: 100)
WAITING_ROOM_WAVE_INTERVAL_MS=30000  # Wave advance interval (default: 30s)

# Reservation Configuration
RESERVATION_TTL_MINUTES=3            # Reservation timeout (default: 3 minutes)
EVENT_PURCHASE_LIMIT=6               # Max tickets per user per event (default: 6)

# Worker Configuration
EXPIRATION_WORKER_INTERVAL_MS=60000  # Worker check interval (default: 60s)

# Frontend URL (for CORS)
FRONTEND_URL=https://your-domain.vercel.app
```

## Vercel Configuration

The `vercel.json` file is configured to:

1. **Install dependencies** for root, `api/`, and `web/` directories
2. **Build the frontend** from the `web/` directory
3. **Deploy the API** as a serverless function from `api/index.ts`
4. **Route requests** appropriately:
   - API routes (`/health`, `/events`, `/checkout`, `/admin`, `/me`, `/metrics`) → API function
   - All other routes → Frontend (SPA)

## Database Setup

### Initial Setup

1. **Create your PostgreSQL database** (using a service like Vercel Postgres, Supabase, or Railway)

2. **Initialize the database schema**:
   - The schema is defined in `api/db/init.sql`
   - You can run this manually or use a migration tool
   - For Vercel Postgres, you can use the Vercel CLI or connect via a database client

3. **Seed the database** (optional):
   ```bash
   # Set environment variables locally
   export DB_HOST=...
   export DB_PORT=5432
   export DB_USER=...
   export DB_PASSWORD=...
   export DB_NAME=...
   
   # Run seed script
   cd api
   npm run db:seed
   ```

## Redis Setup

1. **Create a Redis instance** (using a service like Upstash, Redis Cloud, or Railway)

2. **Configure connection**:
   - Set `REDIS_HOST` and `REDIS_PORT` environment variables
   - Or use `REDIS_URL` if your provider supports it

## Deployment Steps

1. **Connect your repository** to Vercel:
   - Go to Vercel Dashboard → Add New Project
   - Import your Git repository

2. **Configure environment variables**:
   - Add all required environment variables in Vercel project settings
   - Set them for Production, Preview, and Development environments as needed

3. **Deploy**:
   - Vercel will automatically detect the `vercel.json` configuration
   - The build process will:
     - Install dependencies
     - Build the frontend
     - Package the API as a serverless function

4. **Verify deployment**:
   - Check `/health` endpoint to verify API is working
   - Check frontend loads correctly
   - Test API endpoints

## Important Notes

### Serverless Function Limitations

- **No background workers**: The expiration worker (`expirationWorker.ts`) is disabled in Vercel environments. Consider using Vercel Cron Jobs or an external service for scheduled tasks.
- **Cold starts**: First request after inactivity may be slower
- **Connection pooling**: Database connections are managed per function invocation

### CORS Configuration

The API is configured to allow:
- Local development URLs (`localhost:5173`, `localhost:3000`)
- All Vercel preview URLs (`.vercel.app` domains)
- Your production domain (via `FRONTEND_URL` environment variable)

### File System Access

- Serverless functions have read-only access to bundled files
- The database initialization script (`src/db/init.ts`) uses file system access, which may not work in serverless. Run database migrations separately.

## Troubleshooting

### Function Not Found (404)

- Check that `api/index.ts` exists and exports the Express app correctly
- Verify `vercel.json` has the correct build configuration
- Check build logs for TypeScript compilation errors

### Database Connection Errors

- Verify all database environment variables are set correctly
- Check that your database allows connections from Vercel's IP ranges
- Ensure SSL is configured if required by your database provider

### Redis Connection Errors

- Verify Redis environment variables are set
- Check that Redis allows connections from Vercel
- Some Redis providers require SSL/TLS configuration

### CORS Errors

- Verify `FRONTEND_URL` is set to your production domain
- Check that your frontend domain is included in the CORS allowed origins
- For preview deployments, Vercel URLs are automatically allowed

## Monitoring

- **Health Check**: `/health` endpoint for basic API status
- **Metrics**: `/metrics` endpoint for Prometheus metrics
- **Vercel Logs**: Check function logs in Vercel dashboard for errors

## Next Steps

1. Set up database migrations (if not using manual SQL)
2. Configure Vercel Cron Jobs for expiration worker tasks
3. Set up monitoring and alerting
4. Configure custom domain
5. Set up CI/CD for automated deployments

