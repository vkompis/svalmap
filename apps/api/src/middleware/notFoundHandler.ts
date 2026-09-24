import { Request, Response, NextFunction } from 'express';

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  res.status(404).json({ success: false, error: 'Not Found', path: req.path, timestamp: new Date().toISOString() });
}


