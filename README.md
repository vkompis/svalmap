# SvalMap - Maritime Monitoring System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![MapLibre](https://img.shields.io/badge/MapLibre-3.6-green.svg)](https://maplibre.org/)

A comprehensive maritime monitoring system focused on the Svalbard EEZ and Barents Sea area. SvalMap provides real-time vessel tracking, incident detection, and security monitoring capabilities using modern web technologies and cloud infrastructure.

## 🌊 Features

- **Real-time Vessel Tracking**: Monitor vessel positions with 5-minute update cadence
- **Incident Detection**: Automated detection of proximity alerts, rendezvous, loitering, and sanctions violations
- **Interactive Maps**: MapLibre-based mapping with real-time vessel visualization
- **Security Monitoring**: Focus on military vessels, research activities, and restricted areas
- **Cloud-Native**: Built on Google Cloud Platform with BigQuery GIS and Firestore
- **Real-time Alerts**: Instant notifications for security incidents and suspicious activities

## 🏗️ Architecture

```
svalmap/
├── apps/
│   ├── web/          # Next.js frontend with MapLibre integration
│   ├── api/          # Express.js REST API backend
│   └── jobs/         # Cloud Run background jobs for data processing
├── packages/
│   ├── types/        # Shared TypeScript interfaces
│   ├── ui/           # Reusable React components
│   └── config/       # Shared configuration and utilities
├── sql/              # BigQuery SQL queries and schema
└── docs/             # Comprehensive documentation
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm 9+
- Google Cloud Platform account
- Docker (for containerization)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/svalmap.git
   cd svalmap
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy environment templates
   cp apps/web/.env.example apps/web/.env.local
   cp apps/api/.env.example apps/api/.env.local
   cp apps/jobs/.env.example apps/jobs/.env.local
   
   # Configure your environment variables
   # See docs/DEPLOY.md for detailed configuration
   ```

4. **Start development servers**
   ```bash
   # Start all applications in development mode
   npm run dev
   
   # Or start individual applications
   npm run dev --workspace=@svalmap/web
   npm run dev --workspace=@svalmap/api
   npm run dev --workspace=@svalmap/jobs
   ```

5. **Access the applications**
   - **Web App**: http://localhost:3000
   - **API**: http://localhost:3001
   - **Jobs**: Running in background

## 🗺️ Geographic Coverage

- **Primary AOI**: Svalbard Exclusive Economic Zone (EEZ)
- **Extended Coverage**: Barents Sea region
- **Focus Areas**: 
  - Military restricted zones
  - Submarine cable infrastructure
  - Research vessel activities
  - Commercial shipping lanes

## 🔧 Technology Stack

### Frontend
- **Next.js 14**: React framework with App Router
- **TypeScript**: Type-safe development
- **MapLibre GL JS**: Open-source mapping library
- **Tailwind CSS**: Utility-first CSS framework

### Backend
- **Node.js**: JavaScript runtime
- **Express.js**: Web framework
- **TypeScript**: Type-safe development
- **Zod**: Schema validation

### Database
- **BigQuery GIS**: Spatial data storage and analytics
- **Firestore**: Real-time document database
- **Cloud Storage**: Map tile hosting

### Infrastructure
- **Google Cloud Platform**: Cloud infrastructure
- **Cloud Run**: Serverless containers
- **BigQuery**: Data warehouse
- **Firestore**: NoSQL database

### Development Tools
- **Turbo**: Monorepo build system
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Vitest**: Unit testing
- **Playwright**: E2E testing

## 📊 Data Sources

- **AIS Data**: Real-time vessel positions from Norwegian Coastal Administration
- **Military Vessel MMSI**: Norwegian Armed Forces vessel identifiers
- **Restricted Areas**: NSM military restricted zones
- **Cable Routes**: Svalbard submarine cable infrastructure
- **Sanctions**: Norwegian and EU sanctions lists

## 🔒 Security Features

- **Incident Detection**: Proximity alerts, rendezvous detection, loitering identification
- **Sanctions Monitoring**: Vessel blacklist checking and alerting
- **Shadow Tracking**: Monitoring vessels that turn off AIS
- **Research Vessel Monitoring**: Special attention to research activities
- **Role-based Access Control**: Multi-level user permissions
- **Audit Logging**: Comprehensive security event tracking

## 📈 Monitoring & Analytics

- **Real-time Updates**: 5-minute cadence for vessel positions
- **Incident Analytics**: Historical incident analysis and trends
- **Performance Metrics**: System performance and usage statistics
- **Cost Monitoring**: Cloud resource usage and cost optimization

## 🚀 Deployment

### Google Cloud Platform

1. **Set up GCP project and enable APIs**
   ```bash
   # See docs/DEPLOY.md for complete setup
   gcloud projects create svalmap-project
   gcloud services enable cloudrun.googleapis.com bigquery.googleapis.com
   ```

2. **Deploy applications**
   ```bash
   # Deploy to Cloud Run
   gcloud run deploy svalmap-web --image gcr.io/PROJECT_ID/svalmap-web:latest
   gcloud run deploy svalmap-api --image gcr.io/PROJECT_ID/svalmap-api:latest
   ```

3. **Set up monitoring and alerts**
   ```bash
   # Configure Cloud Monitoring
   gcloud monitoring workspaces create --project=PROJECT_ID
   ```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or run individual containers
docker run -p 3000:3000 svalmap-web:latest
docker run -p 3001:3001 svalmap-api:latest
```

## 🧪 Testing

### Run Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Type checking
npm run type-check

# Linting
npm run lint
```

### Test Coverage

- **Unit Tests**: Vitest with >90% coverage target
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Playwright browser automation
- **Performance Tests**: Load testing and benchmarking

## 📚 Documentation

- **[Architecture](docs/ARCHITECTURE.md)**: System design and architecture overview
- **[Data Model](docs/DATA_MODEL.md)**: Database schema and data relationships
- **[Security](docs/SECURITY.md)**: Security measures and best practices
- **[Deployment](docs/DEPLOY.md)**: Deployment procedures and infrastructure setup
- **[Style Guide](docs/STYLEGUIDE.md)**: Code standards and development practices
- **[Cost Notes](docs/COST_NOTES.md)**: Cost structure and optimization strategies
- **[Attribution](docs/ATTRIBUTION.md)**: Data sources and third-party attributions

## 🤝 Contributing

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Run tests and linting**
   ```bash
   npm run test
   npm run lint
   npm run type-check
   ```
5. **Commit your changes**
   ```bash
   git commit -m 'feat: add amazing feature'
   ```
6. **Push to your branch**
   ```bash
   git push origin feature/amazing-feature
   ```
7. **Create a Pull Request**

### Code Standards

- Follow the [Style Guide](docs/STYLEGUIDE.md)
- Use TypeScript for all new code
- Write comprehensive tests
- Update documentation as needed
- Follow conventional commit messages

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Norwegian Coastal Administration** for AIS data
- **Norwegian Armed Forces** for military vessel information
- **OpenStreetMap contributors** for base map data
- **MapLibre contributors** for open-source mapping library

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/svalmap/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/svalmap/discussions)
- **Email**: support@svalmap.com

## 🔮 Roadmap

### Phase 1 (Q1 2024)
- [x] Core infrastructure setup
- [x] Basic vessel tracking
- [x] Incident detection algorithms
- [x] Web interface foundation

### Phase 2 (Q2 2024)
- [ ] Advanced analytics dashboard
- [ ] Machine learning incident detection
- [ ] Mobile application
- [ ] API rate limiting and caching

### Phase 3 (Q3 2024)
- [ ] Multi-region deployment
- [ ] Advanced reporting tools
- [ ] Integration with external systems
- [ ] Performance optimization

### Phase 4 (Q4 2024)
- [ ] AI-powered threat assessment
- [ ] Predictive analytics
- [ ] Advanced visualization tools
- [ ] Enterprise features

---

**SvalMap** - Protecting maritime security in the Arctic through intelligent monitoring and real-time awareness.

*Built with ❤️ for the maritime community*
