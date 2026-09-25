# SvalMap Attribution

## Overview
This document provides proper attribution and credits for all data sources, third-party services, and open-source software used in the SvalMap maritime monitoring system. Proper attribution is essential for compliance with licenses and ethical data usage.

## Data Sources

### AIS Data Providers
- **Norwegian Coastal Administration (Kystverket)**
  - **Data**: Real-time AIS vessel positions in Norwegian waters
  - **License**: Government data, freely available
  - **Attribution**: "Data provided by Norwegian Coastal Administration"
  - **Update Frequency**: Real-time (every 5 minutes)

- **Marine Traffic**
  - **Data**: Global AIS vessel tracking data
  - **License**: Commercial license required
  - **Attribution**: "AIS data provided by Marine Traffic"
  - **Coverage**: Worldwide maritime traffic

- **OpenSeaMap**
  - **Data**: Open-source maritime data
  - **License**: Creative Commons Attribution-ShareAlike 3.0
  - **Attribution**: "© OpenSeaMap contributors"
  - **Coverage**: Global maritime information

### Geographic Data Sources

#### Svalbard EEZ Boundaries
- **Norwegian Directorate of Fisheries**
  - **Data**: Svalbard Exclusive Economic Zone boundaries
  - **License**: Government data, freely available
  - **Attribution**: "EEZ boundaries: Norwegian Directorate of Fisheries"
  - **Format**: Shapefile, GeoJSON

#### Military Restricted Areas
- **Norwegian Armed Forces (Forsvaret)**
  - **Data**: Military training areas and restricted zones
  - **License**: Government data, freely available
  - **Attribution**: "Restricted areas: Norwegian Armed Forces"
  - **Format**: Shapefile, GeoJSON

#### Submarine Cable Routes
- **Norwegian Communications Authority (Nkom) / GeoNorge**
  - **Data**: Dense national telecom/power cable segments
  - **License**: Government data
  - **Attribution**: "Cable routes: Norwegian Communications Authority / GeoNorge"
  - **Layer**: Undersea cables (Nkom / GeoNorge)

- **TeleGeography Submarine Cable Map**
  - **Data**: Named international cable systems landing in Norway (17 systems)
  - **Source**: https://www.submarinecablemap.com/country/norway
  - **License**: Historically CC BY-NC-SA (non-commercial); commercial use requires a TeleGeography license
  - **Attribution**: "© TeleGeography Submarine Cable Map"
  - **Layer**: Named cables — Submarine Cable Map (Norway)

### Navigation warnings
- **Norwegian Coastal Administration (Kystverket)**
  - **API**: `https://api.kystverket.no/data/navigationwarnings/navareaxix/` and `.../coastal/`
  - **Coverage**: Currently **active** NAVAREA XIX + coastal (NAVCO) warnings; filtered to those issued within the last 30 days
  - **Note**: The public API does not provide a full cancelled/historical archive
  - **Disclaimer**: Not a substitute for NAVTEX / SafetyNET / SafetyCast

### Vessel Registry Data
- **Norwegian Maritime Authority (Sjøfartsdirektoratet)**
  - **Data**: Norwegian vessel registry information
  - **License**: Government data, freely available
  - **Attribution**: "Vessel registry: Norwegian Maritime Authority"
  - **Update Frequency**: Daily

- **International Maritime Organization (IMO)**
  - **Data**: Global vessel identification numbers
  - **License**: International organization data
  - **Attribution**: "IMO numbers: International Maritime Organization"
  - **Coverage**: Worldwide

### Sanctions and Blacklist Data
- **Norwegian Ministry of Foreign Affairs**
  - **Data**: Norwegian sanctions lists
  - **License**: Government data, freely available
  - **Attribution**: "Sanctions data: Norwegian Ministry of Foreign Affairs"
  - **Update Frequency**: As published

- **European Union Sanctions**
  - **Data**: EU sanctions and restrictive measures
  - **License**: EU official data
  - **Attribution**: "EU sanctions: European Union"
  - **Update Frequency**: As published

## Third-Party Services

### Map Services
- **MapLibre GL JS**
  - **Service**: Open-source mapping library
  - **License**: ISC License
  - **Attribution**: "© MapLibre contributors"
  - **Website**: https://maplibre.org/

- **OpenStreetMap**
  - **Service**: Base map tiles and geographic data
  - **License**: Open Data Commons Open Database License
  - **Attribution**: "© OpenStreetMap contributors"
  - **Website**: https://www.openstreetmap.org/

### Cloud Infrastructure
- **Google Cloud Platform**
  - **Service**: Cloud computing and hosting
  - **License**: Commercial service
  - **Attribution**: "Powered by Google Cloud Platform"
  - **Services Used**: Cloud Run, BigQuery, Firestore, Cloud Storage

### Development Tools
- **Next.js**
  - **Service**: React framework
  - **License**: MIT License
  - **Attribution**: "Built with Next.js"
  - **Website**: https://nextjs.org/

- **TypeScript**
  - **Service**: Programming language
  - **License**: Apache License 2.0
  - **Attribution**: "Developed with TypeScript"
  - **Website**: https://www.typescriptlang.org/

## Open Source Software

### Core Dependencies
```json
{
  "dependencies": {
    "react": "MIT License",
    "express": "MIT License",
    "maplibre-gl": "ISC License",
    "winston": "MIT License",
    "zod": "MIT License"
  }
}
```

### Development Dependencies
```json
{
  "devDependencies": {
    "typescript": "Apache License 2.0",
    "eslint": "MIT License",
    "prettier": "MIT License",
    "vitest": "MIT License",
    "playwright": "Apache License 2.0"
  }
}
```

## Attribution Requirements

### Map Attribution
All maps must display the following attribution:
```
© OpenStreetMap contributors | © MapLibre contributors
Data: Norwegian Coastal Administration, Norwegian Armed Forces
```

### API Attribution
API responses must include attribution headers:
```typescript
// Example API response headers
res.set({
  'X-Data-Source': 'Norwegian Coastal Administration, Norwegian Armed Forces',
  'X-Map-Attribution': '© OpenStreetMap contributors | © MapLibre contributors'
});
```

### User Interface Attribution
The web interface must display attribution in the footer or sidebar:
```typescript
const AttributionFooter: React.FC = () => (
  <footer className="attribution-footer">
    <div className="attribution-content">
      <p>Data sources:</p>
      <ul>
        <li>AIS: Norwegian Coastal Administration</li>
        <li>Restricted Areas: Norwegian Armed Forces</li>
        <li>Cable Routes: Norwegian Communications Authority</li>
        <li>Base Maps: OpenStreetMap contributors</li>
      </ul>
      <p>Maps: © MapLibre contributors</p>
    </div>
  </footer>
);
```

## License Compliance

### Open Source Licenses
- **MIT License**: React, Express, Winston, Zod
- **ISC License**: MapLibre GL JS
- **Apache License 2.0**: TypeScript, Playwright
- **Creative Commons**: OpenStreetMap data

### Commercial Licenses
- **Google Cloud Platform**: Commercial service agreement
- **Marine Traffic**: Commercial data license (if used)

### Government Data
- **Norwegian Government Data**: Freely available under Norwegian law
- **EU Data**: Available under EU open data policies

## Data Usage Rights

### Permitted Uses
- Maritime monitoring and security
- Research and analysis
- Public safety and emergency response
- Regulatory compliance

### Restrictions
- Commercial resale of raw data
- Modification of government data without permission
- Use for illegal activities
- Violation of vessel privacy rights

## Update Procedures

### Regular Attribution Updates
- **Monthly**: Review and update data source information
- **Quarterly**: Verify license compliance
- **Annually**: Comprehensive attribution audit

### New Data Sources
When adding new data sources:
1. Verify license and usage rights
2. Add to attribution documentation
3. Update user interface attribution
4. Include in API responses
5. Update this document

### License Changes
If data source licenses change:
1. Immediately review compliance
2. Update attribution as required
3. Notify stakeholders
4. Consider alternative sources if necessary

## Contact Information

### Data Source Contacts
- **Norwegian Coastal Administration**: post@kystverket.no
- **Norwegian Armed Forces**: post@mil.no
- **Norwegian Communications Authority**: post@nkom.no

### Attribution Questions
For questions about attribution or licensing:
- **Technical Team**: tech@svalmap.com
- **Legal Team**: legal@svalmap.com
- **Project Manager**: pm@svalmap.com

## Version History

### Attribution Document Versions
- **v1.0.0** (2024-01-01): Initial attribution documentation
- **v1.1.0** (2024-01-15): Added EU sanctions data
- **v1.2.0** (2024-02-01): Updated MapLibre attribution

### Change Log
- Added Norwegian Communications Authority cable data
- Updated OpenStreetMap attribution requirements
- Added MapLibre GL JS attribution
- Expanded third-party service attributions

## Compliance Checklist

### Required Attributions
- [ ] OpenStreetMap contributors
- [ ] MapLibre contributors
- [ ] Norwegian Coastal Administration
- [ ] Norwegian Armed Forces
- [ ] Norwegian Communications Authority
- [ ] Norwegian Maritime Authority

### License Compliance
- [ ] MIT License dependencies
- [ ] ISC License dependencies
- [ ] Apache License dependencies
- [ ] Creative Commons data
- [ ] Government data usage rights

### User Interface
- [ ] Map attribution displayed
- [ ] Data source attribution visible
- [ ] Footer attribution included
- [ ] API attribution headers set

## Conclusion

Proper attribution is fundamental to ethical and compliant data usage. This document ensures that all data sources, services, and software are properly credited according to their respective licenses and requirements.

Regular review and updates of this attribution documentation help maintain compliance and demonstrate respect for the intellectual property and data rights of all contributors to the SvalMap system.

For questions or updates to this attribution documentation, please contact the technical team or legal team as appropriate.
