# Vercel Deployment Checklist

Use this checklist before deploying to Vercel to ensure everything is configured correctly.

## Pre-Deployment

### Environment Variables
- [ ] `DB_HOST` - PostgreSQL host
- [ ] `DB_PORT` - PostgreSQL port (usually 5432)
- [ ] `DB_USER` - PostgreSQL username
- [ ] `DB_PASSWORD` - PostgreSQL password
- [ ] `DB_NAME` - PostgreSQL database name
- [ ] `REDIS_HOST` - Redis host
- [ ] `REDIS_PORT` - Redis port (usually 6379)
- [ ] `QR_SECRET` - Secret key for QR code signatures (use a strong random string)
- [ ] `FRONTEND_URL` - Your production domain (optional, for CORS)

### Database Setup
- [ ] PostgreSQL database created and accessible
- [ ] Database schema initialized (run `api/db/init.sql`)
- [ ] Database seeded with test data (optional, run `api/db/seed.ts`)

### Redis Setup
- [ ] Redis instance created and accessible
- [ ] Redis connection tested

### Code Review
- [ ] All environment variables have fallbacks or are documented as required
- [ ] No hardcoded secrets or credentials
- [ ] CORS configuration allows your production domain
- [ ] Error handling is in place for database/Redis connection failures

## Deployment

### Vercel Configuration
- [ ] Repository connected to Vercel
- [ ] All environment variables set in Vercel dashboard
- [ ] Build command verified: `cd web && npm run build`
- [ ] Output directory verified: `web/dist`
- [ ] API function path verified: `api/index.ts`

### Build Verification
- [ ] Build completes successfully
- [ ] No TypeScript compilation errors
- [ ] No missing dependency errors
- [ ] Frontend assets built correctly

## Post-Deployment

### Health Checks
- [ ] `/health` endpoint returns 200 OK
- [ ] Frontend loads correctly
- [ ] No console errors in browser

### API Testing
- [ ] `GET /events` returns events list
- [ ] `GET /health` returns status
- [ ] `GET /metrics` returns Prometheus metrics
- [ ] Database queries work (test an endpoint that uses DB)
- [ ] Redis operations work (test waiting room functionality)

### CORS Testing
- [ ] Frontend can make API requests from production domain
- [ ] No CORS errors in browser console
- [ ] Preview deployments work (if using preview URLs)

### Performance
- [ ] API response times are acceptable
- [ ] Frontend loads quickly
- [ ] No memory leaks or excessive resource usage

## Troubleshooting

### Common Issues

**Function returns 404:**
- Check `vercel.json` routing configuration
- Verify `api/index.ts` exists and exports correctly
- Check build logs for TypeScript errors

**Database connection errors:**
- Verify all DB_* environment variables are set
- Check database allows connections from Vercel IPs
- Verify SSL configuration if required

**Redis connection errors:**
- Verify REDIS_HOST and REDIS_PORT are set
- Check Redis allows connections from Vercel
- Verify SSL/TLS if required by provider

**CORS errors:**
- Verify FRONTEND_URL is set to production domain
- Check CORS configuration in `src/index.ts`
- Ensure origin matches allowed patterns

**Build failures:**
- Check `package.json` files for correct dependencies
- Verify Node.js version compatibility
- Check for TypeScript errors in build logs

## Monitoring

- [ ] Set up Vercel function logs monitoring
- [ ] Configure alerts for errors
- [ ] Monitor database connection pool usage
- [ ] Track API response times
- [ ] Monitor Redis connection health

## Next Steps

After successful deployment:
1. Set up custom domain (if needed)
2. Configure Vercel Cron Jobs for background tasks
3. Set up monitoring and alerting
4. Configure CI/CD for automated deployments
5. Set up database backups
6. Configure Redis persistence (if needed)

