import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { config, getEnvironment } from '@svalmap/config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import vesselRoutes from './routes/vessels';
import areaRoutes from './routes/areas';
import overlaysRoutes from './routes/overlays';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = config.api.port;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors(config.api.cors));

// Rate limiting
const limiter = rateLimit(config.security.rateLimit);
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: getEnvironment(),
  });
});

// API routes
app.use('/api/v1/vessels', vesselRoutes);
app.use('/api/v1/areas', areaRoutes);
app.use('/api/v1/overlays', overlaysRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`SvalMap API server running on port ${PORT}`, {
    environment: getEnvironment(),
    cors: config.api.cors.origin,
    rateLimit: config.security.rateLimit,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;
