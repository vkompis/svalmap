export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Environment variables
export const config = {
  // Map configuration
  map: {
    baseUrl: process.env.MAP_BASE_URL || 'https://tiles.openfreemap.org',
    styleUrl: process.env.MAP_STYLE || process.env.NEXT_PUBLIC_MAP_STYLE || '/styles/svalmap-dark.json',
    attribution: process.env.MAP_ATTRIBUTION || process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '© OpenStreetMap contributors',
    defaultCenter: { latitude: 69, longitude: 12 },
    defaultZoom: 3.5,
  },

  // Database configuration
  database: {
    bigQuery: {
      projectId: process.env.BIGQUERY_PROJECT_ID || 'svalmap-project',
      datasetId: process.env.BIGQUERY_DATASET_ID || 'maritime_data',
      location: process.env.BIGQUERY_LOCATION || 'europe-west1',
    },
    firestore: {
      projectId: process.env.FIRESTORE_PROJECT_ID || 'svalmap-project',
      collectionPrefix: process.env.FIRESTORE_COLLECTION_PREFIX || 'svalmap',
    },
  },

  // API configuration
  api: {
    port: parseInt(process.env.API_PORT || '3001'),
    host: process.env.API_HOST || 'localhost',
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
      credentials: true,
    },
  },

  // Job configuration
  jobs: {
    updateInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
    batchSize: parseInt(process.env.BATCH_SIZE || '1000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  },

  // Security configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    jwtExpiry: process.env.JWT_EXPIRY || '1h',
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    },
  },

  // Monitoring configuration
  monitoring: {
    logLevel: process.env.LOG_LEVEL || 'info',
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
  },
} as const;

// Geographic constants
export const GEO_CONSTANTS = {
  // Svalbard EEZ approximate boundaries
  SVALBARD_EEZ: {
    north: 84.0,
    south: 74.0,
    east: 35.0,
    west: 10.0,
  } as BoundingBox,

  // Barents Sea extended area
  BARENTS_SEA: {
    north: 82.0,
    south: 67.0,
    east: 45.0,
    west: 10.0,
  } as BoundingBox,

  // Critical infrastructure coordinates
  CRITICAL_POINTS: {
    LONGYEARBYEN: { latitude: 78.2233, longitude: 15.6267 },
    SVALBARD_CABLE_LANDING: { latitude: 78.2233, longitude: 15.6267 },
    BARENTS_CABLE_LANDING: { latitude: 70.0, longitude: 30.0 },
  },

  // Alert thresholds (in nautical miles)
  THRESHOLDS: {
    PROXIMITY_ALERT: 5, // 5 NM from restricted areas
    RENDEZVOUS_DISTANCE: 2, // 2 NM between vessels
    LOITERING_RADIUS: 10, // 10 NM radius for loitering detection
  },
} as const;

// Time constants
export const TIME_CONSTANTS = {
  UPDATE_INTERVALS: {
    VESSEL_POSITIONS: 5 * 60 * 1000, // 5 minutes
    INCIDENT_DETECTION: 5 * 60 * 1000, // 5 minutes
    ANALYTICS_AGGREGATION: 24 * 60 * 60 * 1000, // 24 hours
    SANCTIONS_CHECK: 60 * 60 * 1000, // 1 hour
  },

  RETENTION_PERIODS: {
    VESSEL_POSITIONS: 90 * 24 * 60 * 60 * 1000, // 90 days
    INCIDENTS: 365 * 24 * 60 * 60 * 1000, // 1 year
    ANALYTICS: 5 * 365 * 24 * 60 * 60 * 1000, // 5 years
  },
} as const;

// API endpoints
export const API_ENDPOINTS = {
  V1: {
    VESSELS: '/api/v1/vessels',
    POSITIONS: '/api/v1/positions',
    INCIDENTS: '/api/v1/incidents',
    ALERTS: '/api/v1/alerts',
    AREAS: '/api/v1/areas',
    ANALYTICS: '/api/v1/analytics',
  },
} as const;

// Error messages
export const ERROR_MESSAGES = {
  VALIDATION: {
    INVALID_COORDINATES: 'Invalid coordinates provided',
    INVALID_MMSI: 'Invalid MMSI format',
    INVALID_TIMESTAMP: 'Invalid timestamp format',
    MISSING_REQUIRED_FIELD: 'Missing required field',
  },
  DATABASE: {
    CONNECTION_FAILED: 'Database connection failed',
    QUERY_FAILED: 'Database query failed',
    TRANSACTION_FAILED: 'Database transaction failed',
  },
  AUTH: {
    INVALID_TOKEN: 'Invalid authentication token',
    TOKEN_EXPIRED: 'Authentication token expired',
    INSUFFICIENT_PERMISSIONS: 'Insufficient permissions',
  },
} as const;

// Utility functions
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';

export const getEnvironment = () => process.env.NODE_ENV || 'development';
export const isDebugMode = () => process.env.DEBUG === 'true' || isDevelopment;
