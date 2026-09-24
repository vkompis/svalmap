# SvalMap Cost Notes

## Overview
This document outlines the cost structure, optimization strategies, and budget considerations for the SvalMap maritime monitoring system. Understanding costs is crucial for sustainable operation and scaling decisions.

## Cost Structure

### Google Cloud Platform Costs

#### Compute Costs
- **Cloud Run (API & Jobs)**
  - API Service: ~$50-100/month (depending on traffic)
  - Background Jobs: ~$30-60/month (depending on processing volume)
  - Total Compute: ~$80-160/month

- **Cloud Functions (Event-driven processing)**
  - Real-time alerts: ~$20-40/month
  - Data processing triggers: ~$15-30/month
  - Total Functions: ~$35-70/month

#### Storage Costs
- **BigQuery GIS**
  - Data storage: ~$0.02/GB/month
  - Query processing: ~$5.00/TB
  - Estimated monthly: ~$100-300/month (depending on data volume)

- **Firestore**
  - Document reads: ~$0.06/100K reads
  - Document writes: ~$0.18/100K writes
  - Document deletes: ~$0.02/100K deletes
  - Estimated monthly: ~$50-150/month

- **Cloud Storage (Map tiles)**
  - Map tile storage: ~$0.02/GB/month
  - Data transfer: ~$0.12/GB
  - Estimated monthly: ~$20-80/month

#### Network Costs
- **Load Balancing**
  - Load balancer: ~$18/month
  - Data processed: ~$0.12/GB
  - Estimated monthly: ~$30-80/month

- **CDN (Cloud CDN)**
  - Cache egress: ~$0.08/GB
  - Estimated monthly: ~$15-40/month

### Third-Party Service Costs

#### Map Services
- **MapLibre (Self-hosted)**
  - Tile hosting: ~$20-50/month
  - Data processing: ~$10-30/month
  - Total Maps: ~$30-80/month

#### Monitoring & Observability
- **Google Cloud Monitoring**
  - Basic monitoring: Included
  - Custom metrics: ~$0.25/metric/month
  - Estimated monthly: ~$10-30/month

- **Logging & Analytics**
  - Cloud Logging: Included
  - Log Analytics: ~$0.50/GB
  - Estimated monthly: ~$20-60/month

### Development & Operations Costs

#### CI/CD Pipeline
- **GitHub Actions**
  - Public repositories: Free
  - Private repositories: ~$4/month per user
  - Estimated monthly: ~$20-100/month

#### Development Tools
- **Code Quality Tools**
  - ESLint, Prettier: Free
  - SonarQube: ~$10-50/month
  - Estimated monthly: ~$10-50/month

## Cost Optimization Strategies

### Compute Optimization

#### Cloud Run Optimization
```typescript
// Use appropriate memory allocation
const cloudRunConfig = {
  memory: '512Mi',        // Start with minimum required
  cpu: '1',               // Use fractional CPU when possible
  maxInstances: 10,       // Limit maximum instances
  concurrency: 80         // Optimize request handling
};

// Implement auto-scaling policies
const scalingPolicy = {
  minInstances: 0,        // Scale to zero when not in use
  maxInstances: 10,       // Prevent runaway scaling
  targetCpuUtilization: 70 // Scale at 70% CPU usage
};
```

#### Background Job Optimization
```typescript
// Batch processing to reduce function calls
export class BatchProcessor {
  private batchSize = 1000;
  private batchTimeout = 5000; // 5 seconds
  
  async processBatch(items: VesselUpdate[]): Promise<void> {
    const batches = this.chunkArray(items, this.batchSize);
    
    for (const batch of batches) {
      await this.processBatchItems(batch);
      // Add delay between batches to avoid overwhelming systems
      await this.delay(100);
    }
  }
}
```

### Storage Optimization

#### BigQuery Optimization
```sql
-- Use clustering for frequently queried columns
CREATE TABLE vessel_positions (
  -- ... other columns
)
PARTITION BY partition_date
CLUSTER BY mmsi, status;

-- Implement data lifecycle management
-- Delete old position data after 90 days
CREATE OR REPLACE TABLE vessel_positions_archive AS
SELECT * FROM vessel_positions 
WHERE partition_date < DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);

-- Drop old partitions
ALTER TABLE vessel_positions 
DROP PARTITION partition_date < DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);
```

#### Firestore Optimization
```typescript
// Use efficient data structures
interface VesselSummary {
  mmsi: string;
  name: string;
  lastPosition: {
    coordinates: Coordinates;
    timestamp: Date;
    speed: number;
  };
  // Only store essential data for real-time updates
}

// Implement data compression
const compressVesselData = (vessel: VesselData): VesselSummary => ({
  mmsi: vessel.mmsi,
  name: vessel.name,
  lastPosition: {
    coordinates: vessel.lastPosition.coordinates,
    timestamp: vessel.lastPosition.timestamp,
    speed: Math.round(vessel.lastPosition.speed * 10) / 10 // Round to 1 decimal
  }
});
```

### Network Optimization

#### CDN Strategy
```typescript
// Cache static assets aggressively
const cdnConfig = {
  '*.js': {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Encoding': 'gzip'
  },
  '*.css': {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Encoding': 'gzip'
  },
  '*.png': {
    'Cache-Control': 'public, max-age=2592000', // 30 days
    'Content-Encoding': 'gzip'
  }
};

// Implement map tile caching
const tileCacheConfig = {
  maxAge: 86400, // 24 hours
  staleWhileRevalidate: 3600, // 1 hour
  cacheKey: (z: number, x: number, y: number) => `${z}/${x}/${y}`
};
```

#### API Optimization
```typescript
// Implement response caching
const cacheMiddleware = (ttl: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const cacheKey = `api:${req.originalUrl}`;
    const cached = cache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }
    
    // Cache response for future requests
    res.on('finish', () => {
      if (res.statusCode === 200) {
        cache.set(cacheKey, res.locals.data, ttl);
      }
    });
    
    next();
  };
};

// Use for vessel data (cache for 30 seconds)
app.use('/api/v1/vessels', cacheMiddleware(30));
```

## Cost Monitoring & Alerts

### Budget Alerts
```typescript
// Set up budget alerts in Google Cloud
const budgetConfig = {
  budgetAmount: 1000, // $1000 USD
  alertThresholdRules: [
    { thresholdPercent: 50, spendType: 'FORECASTED' },
    { thresholdPercent: 100, spendType: 'FORECASTED' },
    { thresholdPercent: 150, spendType: 'FORECASTED' }
  ],
  notificationChannels: ['email:admin@svalmap.com']
};
```

### Cost Tracking Dashboard
```typescript
// Implement cost tracking
interface CostMetrics {
  date: string;
  service: string;
  cost: number;
  usage: string;
}

const trackCosts = async (): Promise<CostMetrics[]> => {
  const billingClient = new CloudBillingClient();
  const [accounts] = await billingClient.listBillingAccounts();
  
  // Track costs by service and date
  return costData.map(item => ({
    date: item.date,
    service: item.service,
    cost: item.cost,
    usage: item.usage
  }));
};
```

## Scaling Considerations

### Horizontal Scaling
```typescript
// Auto-scaling configuration
const scalingConfig = {
  // Scale based on CPU usage
  cpuTarget: 70,
  
  // Scale based on request rate
  requestTarget: 1000,
  
  // Scale based on memory usage
  memoryTarget: 80,
  
  // Cooldown periods
  scaleUpCooldown: 60,    // 1 minute
  scaleDownCooldown: 300  // 5 minutes
};
```

### Vertical Scaling
```typescript
// Memory optimization
const memoryConfig = {
  // Use appropriate memory for different workloads
  api: '512Mi',      // API services
  jobs: '1Gi',       // Background processing
  functions: '256Mi' // Event-driven functions
};

// CPU optimization
const cpuConfig = {
  api: '1',          // 1 vCPU
  jobs: '2',         // 2 vCPU for heavy processing
  functions: '0.5'   // 0.5 vCPU for lightweight tasks
};
```

## Cost Estimation by Scale

### Small Scale (Development/Testing)
- **Monthly Cost**: $200-400
- **Users**: 5-20
- **Vessels**: 100-1,000
- **Data Volume**: 1-10 GB/month

### Medium Scale (Production)
- **Monthly Cost**: $500-1,200
- **Users**: 20-100
- **Vessels**: 1,000-10,000
- **Data Volume**: 10-100 GB/month

### Large Scale (Enterprise)
- **Monthly Cost**: $1,200-3,000
- **Users**: 100-500
- **Vessels**: 10,000-100,000
- **Data Volume**: 100 GB-1 TB/month

### Enterprise Scale (Multi-Region)
- **Monthly Cost**: $3,000-8,000
- **Users**: 500+
- **Vessels**: 100,000+
- **Data Volume**: 1 TB+/month

## Cost Reduction Recommendations

### Immediate Actions
1. **Enable auto-scaling** to scale to zero when not in use
2. **Implement data lifecycle management** to delete old data
3. **Use appropriate instance sizes** based on actual usage
4. **Enable compression** for all data transfers

### Medium-term Optimizations
1. **Implement caching strategies** to reduce database queries
2. **Optimize data structures** to minimize storage requirements
3. **Use spot instances** for non-critical workloads
4. **Implement data archiving** for long-term storage

### Long-term Strategies
1. **Multi-region deployment** for global users
2. **Hybrid cloud approach** for cost-sensitive workloads
3. **Data tiering** with different storage classes
4. **Reserved capacity** for predictable workloads

## Budget Planning

### Annual Budget Planning
```typescript
interface AnnualBudget {
  year: number;
  totalBudget: number;
  quarterlyBudgets: {
    Q1: number;
    Q2: number;
    Q3: number;
    Q4: number;
  };
  contingency: number; // 20% buffer
}

const annualBudget: AnnualBudget = {
  year: 2024,
  totalBudget: 12000, // $12,000 USD
  quarterlyBudgets: {
    Q1: 2500,
    Q2: 3000,
    Q3: 3500,
    Q4: 3000
  },
  contingency: 2400 // 20% of total budget
};
```

### Cost Forecasting
```typescript
// Predict costs based on usage patterns
const forecastCosts = (currentUsage: UsageMetrics): CostForecast => {
  const growthRate = 1.15; // 15% monthly growth
  const months = 12;
  
  const forecast = [];
  let currentCost = currentUsage.monthlyCost;
  
  for (let i = 1; i <= months; i++) {
    currentCost *= growthRate;
    forecast.push({
      month: i,
      cost: currentCost,
      cumulative: forecast.reduce((sum, f) => sum + f.cost, 0) + currentCost
    });
  }
  
  return forecast;
};
```

## ROI Analysis

### Cost-Benefit Analysis
```typescript
interface ROICalculation {
  developmentCosts: number;
  operationalCosts: number;
  benefits: {
    timeSaved: number;      // Hours per month
    incidentPrevention: number; // Incidents prevented
    complianceValue: number;    // Regulatory compliance value
  };
  paybackPeriod: number;    // Months to break even
  annualROI: number;        // Return on investment percentage
}

const calculateROI = (): ROICalculation => {
  const totalCosts = developmentCosts + (operationalCosts * 12);
  const totalBenefits = (benefits.timeSaved * hourlyRate * 12) + 
                       (benefits.incidentPrevention * incidentCost * 12) +
                       benefits.complianceValue;
  
  const paybackPeriod = totalCosts / (totalBenefits / 12);
  const annualROI = ((totalBenefits - totalCosts) / totalCosts) * 100;
  
  return { totalCosts, totalBenefits, paybackPeriod, annualROI };
};
```

## Conclusion

The SvalMap system is designed to be cost-effective while providing enterprise-grade maritime monitoring capabilities. By implementing the optimization strategies outlined in this document, organizations can maintain costs within budget while scaling the system to meet growing operational needs.

Regular cost monitoring and optimization reviews are essential to ensure the system remains cost-effective as usage patterns evolve. The modular architecture allows for selective scaling of components based on actual usage requirements.
