# SvalMap Architecture

## System Overview
SvalMap is a maritime monitoring system focused on the Svalbard EEZ and Barents Sea area. The system tracks vessels, detects suspicious activities, and provides real-time monitoring capabilities for maritime security.

## Core Components

### Applications
- **Web App** (`/apps/web`): Next.js frontend with MapLibre integration for real-time vessel tracking and incident visualization
- **API** (`/apps/api`): Node.js/Express backend providing REST endpoints for vessel data and incident management
- **Jobs** (`/apps/jobs`): Cloud Run job for processing AIS data, detecting incidents, and updating analytics

### Packages
- **Types** (`/packages/types`): Shared TypeScript interfaces and types across the monorepo
- **UI** (`/packages/ui`): Reusable React components and design system
- **Config** (`/packages/config`): Shared configuration, constants, and utilities

## Data Architecture

### Storage
- **BigQuery GIS**: Primary storage for vessel positions and incident data with spatial capabilities
- **Firestore**: Document storage for UI summaries, user preferences, and real-time data

### Data Sources
- **AIS Data**: Vessel position and movement data
- **Military Vessel MMSI**: Norwegian military vessel identifiers
- **Restricted Areas**: NSM military restricted zones
- **Cable Routes**: Svalbard submarine cable infrastructure

### Update Cadence
- **Real-time**: Every 5 minutes for vessel positions and incident detection
- **Analytics**: Daily aggregations and trend analysis

## Geographic Scope
- **Primary AOI**: Svalbard Exclusive Economic Zone (EEZ)
- **Extended Coverage**: Barents Sea region
- **Map Provider**: MapLibre (self-hosted tiles via MAP_BASE_URL)

## Security Features
- **Incident Detection**: Proximity alerts, rendezvous detection, loitering identification
- **Sanctions Monitoring**: Vessel blacklist checking and alerting
- **Shadow Tracking**: Monitoring vessels that turn off AIS
- **Research Vessel Monitoring**: Special attention to research activities

## Technology Stack
- **Frontend**: Next.js 14, TypeScript, MapLibre GL JS
- **Backend**: Node.js, Express, TypeScript
- **Testing**: Vitest, Playwright
- **CI/CD**: GitHub Actions
- **Code Quality**: ESLint, Prettier
- **Infrastructure**: Google Cloud Platform (Cloud Run, BigQuery, Firestore)

## Data Flow
1. AIS data ingestion every 5 minutes
2. Real-time processing and incident detection
3. Storage in BigQuery GIS for historical analysis
4. Firestore updates for real-time UI updates
5. Web interface displays current state and alerts

## Monitoring & Alerting
- **Proximity Alerts**: Vessels within restricted areas or near critical infrastructure
- **Rendezvous Detection**: Suspicious vessel meetings
- **Loitering Detection**: Extended presence in sensitive areas
- **Sanctions Violations**: Blacklisted vessel detection
