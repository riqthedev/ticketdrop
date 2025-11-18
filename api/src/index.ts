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
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

startExpirationWorker();

