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
import metricsRouter from './routes/metrics';
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
      'http://localhost:5173', 
      'http://localhost:3000', 
      'http://127.0.0.1:5173',
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[];
    
    // Allow all Vercel preview URLs
    if (origin.includes('.vercel.app') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(requestLogger);
app.use('/health', healthRouter);
app.use('/admin/events', eventsRouter);
app.use('/admin/tiers', tiersRouter);
app.use('/events', publicEventsRouter);
app.use('/events', waitingRoomRouter);
app.use('/events', reservationsRouter);
app.use('/checkout', checkoutRouter);
app.use('/', ticketsRouter); // Mounted at root (for /me/tickets)
app.use('/', metricsRouter);

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
  res.status(404).json({ error: 'Not found', path: req.path });
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

