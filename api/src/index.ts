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

// Only start server and worker if not in Vercel (serverless) environment
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  
  startExpirationWorker();
}

// Export for Vercel serverless functions
export default app;

