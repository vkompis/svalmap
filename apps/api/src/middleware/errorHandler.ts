import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  logger.error('Unhandled error', { err });
  res.status(500).json({ success: false, error: 'Internal server error', timestamp: new Date().toISOString() });
}


