# SvalMap Style Guide

## Overview
This style guide ensures consistency across the SvalMap codebase, documentation, and development practices. All team members should follow these standards to maintain code quality and readability.

## Code Style Standards

### TypeScript/JavaScript

#### Naming Conventions
```typescript
// Variables and functions: camelCase
const vesselPosition = getVesselPosition(mmsi);
const isMilitaryVessel = checkMilitaryStatus(vessel);

// Constants: UPPER_SNAKE_CASE
const MAX_VESSEL_SPEED = 30;
const DEFAULT_UPDATE_INTERVAL = 5 * 60 * 1000;

// Classes and interfaces: PascalCase
class VesselTracker implements ITracker {
  private readonly updateInterval: number;
  
  public async trackVessel(mmsi: string): Promise<void> {
    // Implementation
  }
}

// Enums: PascalCase
enum VesselType {
  Cargo = 'cargo',
  Tanker = 'tanker',
  Military = 'military'
}

// Types: PascalCase
type VesselStatus = 'active' | 'inactive' | 'unknown';
```

#### File Organization
```typescript
// 1. Imports (external packages first)
import express from 'express';
import { z } from 'zod';

// 2. Internal imports
import { config } from '@svalmap/config';
import { VesselType } from '@svalmap/types';

// 3. Type definitions
interface VesselData {
  mmsi: string;
  name: string;
  type: VesselType;
}

// 4. Constants
const VESSEL_CACHE_TTL = 300; // 5 minutes

// 5. Main implementation
export class VesselService {
  // Class implementation
}

// 6. Exports
export default VesselService;
```

#### Function Definitions
```typescript
// Use explicit return types for public functions
export async function fetchVesselData(mmsi: string): Promise<VesselData | null> {
  try {
    const data = await api.get(`/vessels/${mmsi}`);
    return data;
  } catch (error) {
    logger.error('Failed to fetch vessel data', { mmsi, error });
    return null;
  }
}

// Use arrow functions for simple operations
const formatVesselName = (name: string): string => name.trim().toUpperCase();

// Use async/await instead of promises
export async function processVesselUpdates(updates: VesselUpdate[]): Promise<void> {
  for (const update of updates) {
    await processUpdate(update);
  }
}
```

#### Error Handling
```typescript
// Use custom error classes
export class VesselNotFoundError extends Error {
  constructor(mmsi: string) {
    super(`Vessel with MMSI ${mmsi} not found`);
    this.name = 'VesselNotFoundError';
  }
}

// Use Result types for operations that can fail
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export async function findVessel(mmsi: string): Promise<Result<VesselData, VesselNotFoundError>> {
  try {
    const vessel = await vesselRepository.findByMmsi(mmsi);
    if (!vessel) {
      return { success: false, error: new VesselNotFoundError(mmsi) };
    }
    return { success: true, data: vessel };
  } catch (error) {
    return { success: false, error: new VesselNotFoundError(mmsi) };
  }
}
```

### React/Next.js

#### Component Structure
```typescript
// Component with proper typing
interface VesselMarkerProps {
  vessel: VesselData;
  onClick?: (vessel: VesselData) => void;
  isSelected?: boolean;
}

export const VesselMarker: React.FC<VesselMarkerProps> = ({
  vessel,
  onClick,
  isSelected = false
}) => {
  const handleClick = useCallback(() => {
    onClick?.(vessel);
  }, [vessel, onClick]);

  return (
    <div 
      className={clsx(
        'vessel-marker',
        isSelected && 'vessel-marker--selected'
      )}
      onClick={handleClick}
    >
      {/* Component content */}
    </div>
  );
};
```

#### Hooks Usage
```typescript
// Custom hooks with proper typing
export const useVesselData = (mmsi: string) => {
  const [vessel, setVessel] = useState<VesselData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await vesselApi.get(mmsi);
        if (isMounted) {
          setVessel(data);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err as Error);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();
    
    return () => {
      isMounted = false;
    };
  }, [mmsi]);

  return { vessel, loading, error };
};
```

### SQL

#### Query Formatting
```sql
-- Use consistent indentation and spacing
SELECT 
  v.mmsi,
  v.name,
  v.vessel_type,
  vp.coordinates,
  vp.timestamp,
  vp.speed
FROM `svalmap-project.maritime_data.vessels` v
JOIN `svalmap-project.maritime_data.vessel_positions` vp 
  ON v.mmsi = vp.mmsi
WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
  AND vp.partition_date = CURRENT_DATE()
  AND v.is_military = FALSE
ORDER BY vp.timestamp DESC;
```

#### Naming Conventions
```sql
-- Tables: lowercase with underscores
vessel_positions
restricted_areas
cable_routes

-- Columns: lowercase with underscores
vessel_mmsi
created_at
updated_at

-- Aliases: descriptive and short
v AS vessels
vp AS vessel_positions
ra AS restricted_areas
```

## Documentation Standards

### Code Comments

#### JSDoc for Public APIs
```typescript
/**
 * Fetches vessel data from the API
 * @param mmsi - The Maritime Mobile Service Identity of the vessel
 * @param options - Optional parameters for the request
 * @returns Promise resolving to vessel data or null if not found
 * @throws {VesselNotFoundError} When vessel is not found
 * @example
 * ```typescript
 * const vessel = await fetchVesselData('123456789');
 * if (vessel) {
 *   console.log(vessel.name);
 * }
 * ```
 */
export async function fetchVesselData(
  mmsi: string, 
  options?: FetchOptions
): Promise<VesselData | null> {
  // Implementation
}
```

#### Inline Comments
```typescript
// Only comment complex logic, not obvious code
const distance = calculateDistance(point1, point2);

// Convert nautical miles to meters (1 NM = 1852 meters)
const distanceInMeters = distance * 1852;

// Check if vessel is in restricted area (5 NM buffer)
const isInRestrictedArea = distanceInMeters <= 9260;
```

### README Files

#### Structure
```markdown
# Package Name

Brief description of what this package does.

## Installation

```bash
npm install @svalmap/package-name
```

## Usage

Basic usage examples with code snippets.

## API Reference

Documentation of public APIs and interfaces.

## Contributing

Guidelines for contributing to this package.

## License

License information.
```

### API Documentation

#### OpenAPI/Swagger
```yaml
openapi: 3.0.0
info:
  title: SvalMap API
  version: 1.0.0
  description: Maritime monitoring API for Svalbard EEZ

paths:
  /api/v1/vessels:
    get:
      summary: Get vessels
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 100
            maximum: 1000
      responses:
        '200':
          description: List of vessels
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VesselList'
```

## Testing Standards

### Test Structure
```typescript
describe('VesselService', () => {
  let service: VesselService;
  let mockRepository: jest.Mocked<VesselRepository>;

  beforeEach(() => {
    mockRepository = createMockVesselRepository();
    service = new VesselService(mockRepository);
  });

  describe('findByMmsi', () => {
    it('should return vessel when found', async () => {
      // Arrange
      const mmsi = '123456789';
      const expectedVessel = createMockVessel({ mmsi });
      mockRepository.findByMmsi.mockResolvedValue(expectedVessel);

      // Act
      const result = await service.findByMmsi(mmsi);

      // Assert
      expect(result).toEqual(expectedVessel);
      expect(mockRepository.findByMmsi).toHaveBeenCalledWith(mmsi);
    });

    it('should return null when vessel not found', async () => {
      // Arrange
      const mmsi = '123456789';
      mockRepository.findByMmsi.mockResolvedValue(null);

      // Act
      const result = await service.findByMmsi(mmsi);

      // Assert
      expect(result).toBeNull();
    });
  });
});
```

### Test Naming
```typescript
// Use descriptive test names that explain the scenario
it('should return 400 when MMSI format is invalid');
it('should log error when database connection fails');
it('should retry failed requests up to 3 times');
it('should cache vessel data for 5 minutes');
```

## Git Standards

### Commit Messages
```bash
# Use conventional commits format
feat: add vessel proximity detection
fix: resolve memory leak in position updates
docs: update API documentation
style: format code with prettier
refactor: extract vessel validation logic
test: add unit tests for incident detection
chore: update dependencies
```

### Branch Naming
```bash
# Feature branches
feature/vessel-tracking
feature/incident-detection
feature/real-time-alerts

# Bug fix branches
bugfix/memory-leak-fix
bugfix/api-timeout-issue

# Hotfix branches
hotfix/security-vulnerability
hotfix/critical-bug-fix
```

## Performance Standards

### Code Performance
```typescript
// Use appropriate data structures
const vesselMap = new Map<string, VesselData>(); // O(1) lookup
const vesselArray = vessels.filter(v => v.type === 'military'); // O(n) lookup

// Avoid unnecessary re-renders
const memoizedValue = useMemo(() => expensiveCalculation(data), [data]);
const memoizedCallback = useCallback(() => handleClick(id), [id]);

// Use proper async patterns
const results = await Promise.all(requests); // Parallel execution
for (const item of items) {
  await processItem(item); // Sequential execution when needed
}
```

### Database Performance
```sql
-- Use appropriate indexes
CREATE INDEX idx_vessel_positions_mmsi_timestamp 
ON vessel_positions(mmsi, timestamp);

-- Use partitioning for large tables
PARTITION BY partition_date
CLUSTER BY mmsi, status

-- Avoid SELECT * in production
SELECT mmsi, name, coordinates FROM vessels WHERE type = 'military';
```

## Security Standards

### Input Validation
```typescript
// Always validate input data
const vesselSchema = z.object({
  mmsi: z.string().regex(/^\d{9}$/),
  name: z.string().min(1).max(100),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  })
});

// Use the validated data
const validatedData = vesselSchema.parse(request.body);
```

### SQL Injection Prevention
```typescript
// Use parameterized queries
const query = 'SELECT * FROM vessels WHERE mmsi = ?';
const result = await db.query(query, [mmsi]);

// Never concatenate strings
// ❌ WRONG
const query = `SELECT * FROM vessels WHERE mmsi = '${mmsi}'`;

// ✅ CORRECT
const query = 'SELECT * FROM vessels WHERE mmsi = ?';
```

## Accessibility Standards

### React Components
```typescript
// Use semantic HTML and ARIA labels
<button
  aria-label={`Select vessel ${vessel.name}`}
  onClick={() => onSelect(vessel)}
>
  <VesselIcon />
</button>

// Provide alternative text for images
<img 
  src={vesselIcon} 
  alt={`${vessel.type} vessel icon`}
  width={24}
  height={24}
/>

// Use proper heading hierarchy
<h1>Maritime Monitoring Dashboard</h1>
<h2>Active Vessels</h2>
<h3>Vessel Details</h3>
```

## Internationalization

### Text Handling
```typescript
// Use translation keys instead of hardcoded text
const messages = {
  'vessel.notFound': 'Vessel not found',
  'vessel.loading': 'Loading vessel data...',
  'vessel.error': 'Failed to load vessel data'
};

// In components
<span>{t('vessel.notFound')}</span>

// Support multiple languages
const translations = {
  en: { 'vessel.name': 'Vessel Name' },
  no: { 'vessel.name': 'Skipnavn' }
};
```

## Monitoring and Logging

### Logging Standards
```typescript
// Use structured logging
logger.info('Vessel position updated', {
  mmsi: '123456789',
  coordinates: { lat: 78.0, lng: 20.0 },
  timestamp: new Date().toISOString(),
  userId: 'user123'
});

// Use appropriate log levels
logger.debug('Processing vessel update', { mmsi, update });
logger.info('Vessel data synchronized', { count: vessels.length });
logger.warn('High memory usage detected', { usage: memoryUsage });
logger.error('Failed to process vessel update', { error, mmsi });
```

### Performance Monitoring
```typescript
// Measure function performance
const startTime = performance.now();
try {
  await processVesselData(data);
} finally {
  const duration = performance.now() - startTime;
  metrics.histogram('vessel_processing_duration', duration);
}

// Track business metrics
metrics.increment('vessel_updates_processed');
metrics.gauge('active_vessels_count', activeVessels.length);
```
