import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health';
import eventsRouter from './routes/admin/events';
import tiersRouter from './routes/admin/tiers';
import publicEventsRouter from './routes/events';
import waitingRoomRouter from './routes/waiting-room';
import reservationsRouter from './routes/reservations';
import checkoutRouter from './routes/checkout';
import ticketsRouter from './routes/tickets';
import { requestLogger } from './middleware/requestLogger';
import { startExpirationWorker } from './workers/expirationWorker';
import { appConfig } from './config';

// Global error handlers for serverless environments
// These prevent FUNCTION_INVOCATION_FAILED errors from unhandled rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log the error but don't crash - let Vercel handle it gracefully
  if (reason instanceof Error) {
    console.error('Error details:', {
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
    });
  }
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  // In serverless, we should log and let the function complete
  // The platform will handle restarting the function
});

const app = express();
const PORT = appConfig.port;

// Enable CORS for all routes
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      // Local development
      'http://localhost:5173', 
      'http://localhost:3000', 
      'http://127.0.0.1:5173',
      // Vercel deployment URLs (production and preview)
      // VERCEL_URL is set by Vercel and may or may not include protocol
      process.env.VERCEL_URL 
        ? (process.env.VERCEL_URL.startsWith('http') 
            ? process.env.VERCEL_URL 
            : `https://${process.env.VERCEL_URL}`)
        : undefined,
      // Custom frontend URL (for production domain)
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[];
    
    // Normalize origin for comparison (remove trailing slash)
    const normalizedOrigin = origin.replace(/\/$/, '');
    
    // Allow all Vercel preview URLs (covers preview deployments automatically)
    // This includes: *.vercel.app domains for all branches and previews
    // Examples: ticketdrop-phi.vercel.app, ticketdrop-git-main-*.vercel.app, etc.
    if (normalizedOrigin.includes('.vercel.app') || 
        allowedOrigins.some(allowed => normalizedOrigin === allowed.replace(/\/$/, ''))) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(requestLogger);

// Debug middleware to log all incoming requests (helpful for troubleshooting)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    url: req.url,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    query: req.query,
  });
  next();
});

app.use('/health', healthRouter);
app.use('/admin/events', eventsRouter);
app.use('/admin/tiers', tiersRouter);
app.use('/events', publicEventsRouter);
app.use('/events', waitingRoomRouter);
app.use('/events', reservationsRouter);
app.use('/checkout', checkoutRouter);
app.use('/', ticketsRouter); // Mounted at root (for /me/tickets)

// Global error handler middleware (must be last)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Express error handler:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  
  // Don't expose internal error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(isDevelopment && { details: err.stack }),
  });
});

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  console.warn(`404 Not Found: ${req.method} ${req.path}`, {
    url: req.url,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
  });
  res.status(404).json({ 
    error: 'Not found', 
    path: req.path,
    method: req.method,
    url: req.url,
  });
});

// Only start server and worker if not in Vercel (serverless) environment
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  
  startExpirationWorker();
}

// Export for Vercel serverless functions
export default app;

