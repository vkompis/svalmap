# Cursor Rules for SvalMap

## General
- All code must be written in TypeScript, with strict type checking enabled.
- Do not hardcode any secrets, tokens, or API keys; always read from environment variables or Secret Manager.
- All bounding boxes and AOI queries must be clamped to the AOI_WKT polygon.
- Raw AIS positions must **never** be stored in Firestore or sent directly to the browser.
- Use MapLibre, not Mapbox, with tiles and attribution URLs loaded from environment variables.
- Update cadence is every 5 minutes; no polling faster than this.
- Always prefer BigQuery GIS for spatial queries and incident detection.
- All SQL must be parameterized; no string interpolation of user input.

## Data Flow
- Ingest AIS → normalize → filter to AOI → store in BigQuery `positions` table.
- Run detection SQL for proximity, rendezvous, loitering, sanctions, shadow, research vessel incidents.
- For new incidents: write summaries to Firestore with a cooldown window (default 45 minutes).
- Expose incidents and asset boundaries via API with strict validation and access control.

## Testing & Quality
- Include unit tests for all middleware, validation, and utility functions.
- Lint and format code with ESLint + Prettier before commit.
- All spatial queries must be tested with known sample data in `/data/samples`.

## Security
- API must require `X-API-Key` header matching `PUBLIC_API_KEY`.
- CORS must only allow `APP_ORIGIN`.
- CSP must be strict; only allow required domains for API, tiles, fonts.
- Secrets are stored and read from GCP Secret Manager only.



## Code Organization

### Monorepo Structure
- **Apps**: Standalone applications with their own dependencies
- **Packages**: Shared libraries used across multiple apps
- **Root level**: Configuration files, scripts, and documentation

### File Naming
- **Components**: PascalCase (e.g., `VesselTracker.tsx`)
- **Utilities**: camelCase (e.g., `geoUtils.ts`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `API_ENDPOINTS.ts`)
- **Types**: PascalCase with descriptive names (e.g., `VesselPosition.ts`)

### Import Order
1. Node.js built-ins
2. External packages
3. Internal packages
4. Relative imports
5. Type imports

## TypeScript Standards

### Strict Configuration
- Enable all strict flags
- No `any` types without explicit justification
- Use union types over enums where possible
- Prefer interfaces over type aliases for objects

### Type Definitions
- Define types in `/packages/types`
- Export all types from index files
- Use branded types for IDs and coordinates
- Document complex types with JSDoc

### Error Handling
- Use Result types for operations that can fail
- Define custom error classes for domain-specific errors
- Always handle async errors with try-catch

## React/Next.js Patterns

### Component Structure
- Functional components with hooks
- Props interface defined above component
- Destructure props in function signature
- Use React.memo for expensive components

### State Management
- Local state with useState for component-specific data
- Context for app-wide state
- Custom hooks for reusable logic
- Avoid prop drilling beyond 2 levels

### Performance
- Lazy load components and routes
- Use useMemo and useCallback appropriately
- Implement virtual scrolling for large lists
- Optimize re-renders with proper dependency arrays

## API Design

### REST Endpoints
- Use plural nouns for resources
- HTTP status codes for responses
- Consistent error response format
- Version APIs in URL path

### Data Validation
- Validate all inputs with Zod schemas
- Sanitize data before processing
- Return appropriate error messages
- Log validation failures for debugging

## Database Patterns

### BigQuery
- Use GIS functions for spatial queries
- Partition tables by date
- Optimize queries with clustering
- Use materialized views for complex aggregations

### Firestore
- Structure documents for efficient queries
- Use subcollections for related data
- Implement proper indexing strategies
- Handle offline scenarios gracefully

## Testing Strategy

### Unit Tests
- Test all utility functions
- Mock external dependencies
- Use descriptive test names
- Aim for >90% coverage

### Integration Tests
- Test API endpoints
- Test database operations
- Use test databases
- Clean up after each test

### E2E Tests
- Test critical user flows
- Use Playwright for browser automation
- Test responsive design
- Test accessibility features

## Security Guidelines

### Input Validation
- Validate all user inputs
- Sanitize data before storage
- Use parameterized queries
- Implement rate limiting

### Authentication
- Use JWT tokens with short expiration
- Implement refresh token rotation
- Store sensitive data encrypted
- Log security events

### Data Protection
- Encrypt data in transit and at rest
- Implement proper access controls
- Audit data access
- Follow GDPR principles

## Performance Standards

### Frontend
- Lighthouse score >90
- First contentful paint <1.5s
- Bundle size <500KB gzipped
- Optimize images and assets

### Backend
- API response time <200ms
- Database query time <100ms
- Implement caching strategies
- Use connection pooling

## Documentation

### Code Comments
- Document complex algorithms
- Explain business logic
- Use JSDoc for public APIs
- Keep comments up to date

### README Files
- Clear setup instructions
- Environment variables
- API documentation
- Deployment guide

## Git Workflow

### Branch Naming
- `feature/description` for new features
- `bugfix/description` for bug fixes
- `hotfix/description` for urgent fixes
- `chore/description` for maintenance

### Commit Messages
- Use conventional commits format
- Write clear, descriptive messages
- Reference issue numbers
- Keep commits atomic

### Pull Requests
- Include description of changes
- Add screenshots for UI changes
- Request reviews from team members
- Update documentation as needed
