# SvalMap Deployment Guide

## Overview
This document provides comprehensive deployment instructions for the SvalMap maritime monitoring system on Google Cloud Platform. It covers infrastructure setup, application deployment, and operational procedures.

## Prerequisites

### Required Accounts
- **Google Cloud Platform**: Active project with billing enabled
- **GitHub**: Repository access for CI/CD
- **Docker Hub** (optional): For container registry

### Required Tools
- **Google Cloud CLI**: `gcloud` command-line tool
- **Docker**: For containerization
- **Node.js**: Version 18+ for local development
- **Git**: For version control

### Required Permissions
- **Project Owner** or **Editor** role on GCP project
- **Cloud Run Admin** role
- **BigQuery Admin** role
- **Firestore Admin** role
- **Service Account Admin** role

## Infrastructure Setup

### 1. Google Cloud Project Setup

```bash
# Set your project ID
export PROJECT_ID="svalmap-project"
export REGION="europe-west1"
export ZONE="europe-west1-b"

# Create new project (if needed)
gcloud projects create $PROJECT_ID --name="SvalMap Maritime Monitoring"

# Set the active project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  cloudrun.googleapis.com \
  bigquery.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  secretmanager.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com
```

### 2. Service Account Creation

```bash
# Create service account for applications
gcloud iam service-accounts create svalmap-app \
  --display-name="SvalMap Application Service Account"

# Create service account for jobs
gcloud iam service-accounts create svalmap-jobs \
  --display-name="SvalMap Background Jobs Service Account"

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:svalmap-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:svalmap-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:svalmap-jobs@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:svalmap-jobs@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 3. BigQuery Dataset Creation

```bash
# Create BigQuery dataset
bq mk --dataset \
  --location=$REGION \
  $PROJECT_ID:maritime_data

# Create tables using the SQL files
bq query --use_legacy_sql=false < sql/create_tables.sql
```

### 4. Firestore Database Setup

```bash
# Enable Firestore in native mode
gcloud firestore databases create \
  --location=$REGION \
  --type=firestore-native
```

## Application Deployment

### 1. Environment Configuration

Create environment files for each application:

```bash
# Web application environment
cat > apps/web/.env.production << EOF
NODE_ENV=production
MAP_BASE_URL=https://tiles.svalmap.com
MAP_ATTRIBUTION=© OpenStreetMap contributors | © MapLibre contributors
NEXT_PUBLIC_API_URL=https://api.svalmap.com
EOF

# API environment
cat > apps/api/.env.production << EOF
NODE_ENV=production
API_PORT=8080
API_HOST=0.0.0.0
CORS_ORIGIN=https://svalmap.com
BIGQUERY_PROJECT_ID=$PROJECT_ID
BIGQUERY_DATASET_ID=maritime_data
FIRESTORE_PROJECT_ID=$PROJECT_ID
JWT_SECRET=$(openssl rand -base64 32)
EOF

# Jobs environment
cat > apps/jobs/.env.production << EOF
NODE_ENV=production
BIGQUERY_PROJECT_ID=$PROJECT_ID
BIGQUERY_DATASET_ID=maritime_data
FIRESTORE_PROJECT_ID=$PROJECT_ID
BATCH_SIZE=1000
MAX_RETRIES=3
EOF
```

### 2. Docker Image Building

```bash
# Build web application image
cd apps/web
docker build -t gcr.io/$PROJECT_ID/svalmap-web:latest .

# Build API image
cd ../api
docker build -t gcr.io/$PROJECT_ID/svalmap-api:latest .

# Build jobs image
cd ../jobs
docker build -t gcr.io/$PROJECT_ID/svalmap-jobs:latest .

# Push images to Google Container Registry
docker push gcr.io/$PROJECT_ID/svalmap-web:latest
docker push gcr.io/$PROJECT_ID/svalmap-api:latest
docker push gcr.io/$PROJECT_ID/svalmap-jobs:latest
```

### 3. Cloud Run Deployment

#### Web Application
```bash
# Deploy web application
gcloud run deploy svalmap-web \
  --image gcr.io/$PROJECT_ID/svalmap-web:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production \
  --set-env-vars MAP_BASE_URL=https://tiles.svalmap.com \
  --set-env-vars MAP_ATTRIBUTION="© OpenStreetMap contributors | © MapLibre contributors"
```

#### API Service
```bash
# Deploy API service
gcloud run deploy svalmap-api \
  --image gcr.io/$PROJECT_ID/svalmap-api:latest \
  --platform managed \
  --region $REGION \
  --no-allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 2 \
  --max-instances 20 \
  --service-account svalmap-app@$PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production \
  --set-env-vars BIGQUERY_PROJECT_ID=$PROJECT_ID \
  --set-env-vars BIGQUERY_DATASET_ID=maritime_data \
  --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID
```

#### Background Jobs
```bash
# Deploy background jobs
gcloud run jobs create svalmap-jobs \
  --image gcr.io/$PROJECT_ID/svalmap-jobs:latest \
  --region $REGION \
  --memory 2Gi \
  --cpu 2 \
  --max-retries 3 \
  --task-timeout 3600 \
  --service-account svalmap-jobs@$PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production \
  --set-env-vars BIGQUERY_PROJECT_ID=$PROJECT_ID \
  --set-env-vars BIGQUERY_DATASET_ID=maritime_data \
  --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID
```

### 4. Load Balancer Setup

```bash
# Create external IP address
gcloud compute addresses create svalmap-ip \
  --region=$REGION

# Create load balancer
gcloud compute url-maps create svalmap-lb \
  --default-service svalmap-web

# Create HTTPS proxy
gcloud compute target-https-proxies create svalmap-https-proxy \
  --url-map svalmap-lb \
  --ssl-certificates svalmap-ssl-cert

# Create forwarding rule
gcloud compute forwarding-rules create svalmap-https \
  --address=svalmap-ip \
  --target-https-proxy=svalmap-https-proxy \
  --ports=443 \
  --region=$REGION
```

## CI/CD Pipeline Setup

### 1. GitHub Actions Configuration

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run type-check

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Google Cloud
        uses: google-github-actions/setup-gcloud@v0
        with:
          project_id: ${{ secrets.GCP_PROJECT_ID }}
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          export_default_credentials: true
      
      - name: Build and push Docker images
        run: |
          docker build -t gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-web:${{ github.sha }} ./apps/web
          docker build -t gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-api:${{ github.sha }} ./apps/api
          docker build -t gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-jobs:${{ github.sha }} ./apps/jobs
          
          docker push gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-web:${{ github.sha }}
          docker push gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-api:${{ github.sha }}
          docker push gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-jobs:${{ github.sha }}
      
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy svalmap-web \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-web:${{ github.sha }} \
            --region europe-west1 \
            --platform managed
          
          gcloud run deploy svalmap-api \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-api:${{ github.sha }} \
            --region europe-west1 \
            --platform managed
          
          gcloud run jobs update svalmap-jobs \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/svalmap-jobs:${{ github.sha }} \
            --region europe-west1
```

### 2. GitHub Secrets Configuration

Set the following secrets in your GitHub repository:

- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `GCP_SA_KEY`: Base64-encoded service account key JSON

## Monitoring and Observability

### 1. Cloud Monitoring Setup

```bash
# Create monitoring workspace
gcloud monitoring workspaces create \
  --project=$PROJECT_ID \
  --location=$REGION

# Create custom metrics
gcloud monitoring metrics create \
  --project=$PROJECT_ID \
  --metric-descriptor="custom.googleapis.com/svalmap/vessel_updates_processed" \
  --type="custom.googleapis.com/svalmap/vessel_updates_processed" \
  --description="Number of vessel updates processed" \
  --unit="1" \
  --value-type="INT64"
```

### 2. Logging Configuration

```bash
# Create log sinks
gcloud logging sinks create svalmap-logs \
  storage.googleapis.com/projects/$PROJECT_ID/buckets/svalmap-logs \
  --log-filter="resource.type=cloud_run_revision AND resource.labels.service_name=svalmap-api"

# Create log-based metrics
gcloud logging metrics create svalmap-api-errors \
  --description="API error rate" \
  --log-filter="resource.type=cloud_run_revision AND resource.labels.service_name=svalmap-api AND severity>=ERROR"
```

### 3. Alerting Policies

```bash
# Create uptime alert
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/uptime-policy.yaml

# Create error rate alert
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/error-rate-policy.yaml
```

## Security Configuration

### 1. IAM Policies

```bash
# Restrict access to production resources
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="user:admin@example.com" \
  --role="roles/viewer"

# Grant minimal permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:svalmap-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataEditor"
```

### 2. Network Security

```bash
# Create VPC with private subnets
gcloud compute networks create svalmap-vpc \
  --subnet-mode=custom

gcloud compute networks subnets create svalmap-private \
  --network=svalmap-vpc \
  --region=$REGION \
  --range=10.0.0.0/24 \
  --enable-private-ip-google-access

# Create firewall rules
gcloud compute firewall-rules create svalmap-allow-internal \
  --network=svalmap-vpc \
  --allow tcp,udp,icmp \
  --source-ranges=10.0.0.0/8
```

### 3. Secret Management

```bash
# Store sensitive configuration
echo -n "your-jwt-secret" | gcloud secrets create svalmap-jwt-secret --data-file=-

# Grant access to service accounts
gcloud secrets add-iam-policy-binding svalmap-jwt-secret \
  --member="serviceAccount:svalmap-app@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Backup and Recovery

### 1. BigQuery Backup

```bash
# Create backup dataset
bq mk --dataset \
  --location=$REGION \
  $PROJECT_ID:maritime_data_backup

# Schedule automated backups
bq query --use_legacy_sql=false "
CREATE OR REPLACE TABLE \`$PROJECT_ID.maritime_data_backup.vessel_positions_$(date +%Y%m%d)\` AS
SELECT * FROM \`$PROJECT_ID.maritime_data.vessel_positions\`
WHERE partition_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
"
```

### 2. Firestore Backup

```bash
# Enable Firestore export
gcloud firestore export gs://$PROJECT_ID-backup-bucket/firestore-backup \
  --collection-ids=vessels,incidents,alerts
```

## Performance Optimization

### 1. Cloud Run Optimization

```bash
# Configure auto-scaling
gcloud run services update svalmap-api \
  --min-instances=0 \
  --max-instances=50 \
  --concurrency=80 \
  --cpu-throttling \
  --memory=1Gi \
  --cpu=2
```

### 2. BigQuery Optimization

```sql
-- Create materialized views for common queries
CREATE MATERIALIZED VIEW `svalmap-project.maritime_data.vessel_summary_daily` AS
SELECT 
  mmsi,
  DATE(timestamp) as date,
  COUNT(*) as position_updates,
  AVG(speed) as avg_speed,
  ST_UNION_AGG(coordinates) as track
FROM `svalmap-project.maritime_data.vessel_positions`
GROUP BY mmsi, DATE(timestamp)
```

## Troubleshooting

### Common Issues

#### 1. Service Unavailable
```bash
# Check service status
gcloud run services describe svalmap-api --region=$REGION

# Check logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=svalmap-api" --limit=50
```

#### 2. Database Connection Issues
```bash
# Test BigQuery connection
bq query --use_legacy_sql=false "SELECT 1 as test"

# Check Firestore status
gcloud firestore databases describe --database="(default)"
```

#### 3. Memory Issues
```bash
# Monitor resource usage
gcloud run services describe svalmap-api --region=$REGION --format="value(spec.template.spec.containers[0].resources.limits.memory)"

# Increase memory if needed
gcloud run services update svalmap-api --memory=2Gi --region=$REGION
```

## Maintenance Procedures

### 1. Regular Updates

```bash
# Update dependencies
npm update

# Update Docker images
docker pull gcr.io/$PROJECT_ID/svalmap-web:latest
docker pull gcr.io/$PROJECT_ID/svalmap-api:latest
docker pull gcr.io/$PROJECT_ID/svalmap-jobs:latest

# Redeploy services
gcloud run deploy svalmap-web --image gcr.io/$PROJECT_ID/svalmap-web:latest --region=$REGION
gcloud run deploy svalmap-api --image gcr.io/$PROJECT_ID/svalmap-api:latest --region=$REGION
```

### 2. Database Maintenance

```sql
-- Clean up old data
DELETE FROM `svalmap-project.maritime_data.vessel_positions`
WHERE partition_date < DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);

-- Optimize table performance
OPTIMIZE TABLE `svalmap-project.maritime_data.vessel_positions`;
```

## Cost Optimization

### 1. Resource Scaling

```bash
# Scale down during low usage
gcloud run services update svalmap-api \
  --min-instances=0 \
  --max-instances=10 \
  --region=$REGION

# Use appropriate memory allocation
gcloud run services update svalmap-api \
  --memory=512Mi \
  --cpu=1 \
  --region=$REGION
```

### 2. Data Lifecycle Management

```sql
-- Implement data archiving
CREATE OR REPLACE TABLE `svalmap-project.maritime_data.vessel_positions_archive` AS
SELECT * FROM `svalmap-project.maritime_data.vessel_positions`
WHERE partition_date < DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);

-- Drop old partitions
ALTER TABLE `svalmap-project.maritime_data.vessel_positions`
DROP PARTITION partition_date < DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);
```

## Conclusion

This deployment guide provides a comprehensive approach to deploying the SvalMap system on Google Cloud Platform. Follow the steps in order and ensure all prerequisites are met before proceeding.

For additional support or questions about deployment, consult the SvalMap team or refer to the Google Cloud documentation for specific services.

Remember to:
- Test deployments in a staging environment first
- Monitor costs and resource usage
- Keep security configurations up to date
- Regularly backup and maintain the system
- Document any customizations or changes made during deployment
