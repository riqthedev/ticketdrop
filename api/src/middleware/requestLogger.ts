import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header('x-request-id') ?? uuidv4();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  const { method, originalUrl } = req;

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'request.start',
      requestId,
      method,
      path: originalUrl,
    })
  );

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = req.header('x-user-id');
    const eventId = req.params?.id || req.body?.event_id || req.query?.event_id;
    
    const logData: any = {
      level: 'info',
      msg: 'request.end',
      requestId,
      method,
      path: originalUrl,
      status: res.statusCode,
      duration_ms: duration,
    };
    
    if (userId) {
      logData.user_id = userId;
    }
    
    if (eventId) {
      logData.event_id = eventId;
    }
    
    console.log(JSON.stringify(logData));
  });

  next();
}


