# SvalMap Architecture

## System Overview

SvalMap is a maritime monitoring system focused on the Svalbard Fisheries Protection Zone and the North Atlantic north of 54°N. The **live map** is driven by `scripts-runner` (port 8787). `apps/api` and `apps/jobs` are a parallel BigQuery / incident path that is **not** required for the Next.js UI today.

## Core Components

### Live path (map UI)
- **Web App** (`apps/web`): Next.js + MapLibre; polls `/api/live-positions` ~every 20s
- **scripts-runner**: Express API — AISStream + BarentsWatch merge, 24h tracks, GFW proxy, sanctions / shadow caches, Copernicus ice edge, static overlays, Kystverket nav warnings
- **packages/ui**: VesselLayer, OverlayLayers, GfwLayers, IncidentLayer (nav warnings)

### Parallel / optional
- **API** (`apps/api`): Express on :3001 — AOIs, proximity helpers, legacy BarentsWatch vessel API shapes
- **Jobs** (`apps/jobs`): Cloud Run-style AIS ingest + SQL incident detection into BigQuery (not wired to MapCanvas)

### Packages
- **Types** (`packages/types`): Shared TypeScript interfaces
- **UI** (`packages/ui`): MapLibre React layers (canonical Russian research-vessel list)
- **Config** (`packages/config`): Shared constants

## Data Architecture

### Live API state
- In-memory AISStream vessel cache (stale sweep ~45 min)
- Sanctions / shadow / military MMSI sets loaded from `data/source/` (portable via `SVALMAP_ROOT` / `DATA_DIR`)
- Static GeoJSON under `data/source/overlays/`

### Optional storage
- **BigQuery GIS**: Historical positions / incident SQL (`apps/jobs`, `ingestAIS.ts`)
- **Firestore**: Documented for UI summaries; not used by the current map page

### Data sources
- AISStream (N Atlantic ≥54°N) + BarentsWatch live / historic
- DMA / OpenSanctions vessel designations + local shadow-fleet CSVs
- Norwegian military MMSI list (used in live display filter)
- GFW v3 gateway events
- Copernicus / OSI SAF ice edge
- Kystverket NAVAREA XIX

### Update cadence
- **Map**: ~20s live-position poll
- **Sanctions**: weekly updater + startup refresh
- **Ice edge**: daily cron (~06:30) + stale-on-startup
- **GFW**: ~10 min in-memory cache
- **Nav warnings**: 15 min cache

## Geographic Scope
- **FPZ**: Broad AIS (drop small fishing / recreational when length known)
- **Rest of box**: Russian MID 273, curated research, sanctioned, shadow, military AIS type **or** Norwegian military MMSI
- **Map**: MapLibre dark style (`NEXT_PUBLIC_MAP_STYLE`)

## Security
- Optional `API_KEY` / `X-API-Key` on scripts-runner (except `/healthz`, `/api/health`)
- TLS verification on by default; set `TLS_INSECURE=1` only if required
- See `docs/SECURITY.md` for target posture (RBAC / Secret Manager still aspirational for the runner)

## Data Flow (live map)
1. AISStream WS + BarentsWatch live → merge + filter in scripts-runner
2. UI VesselLayer polls `/api/live-positions`, tracks via `/api/tracks24h`
3. Overlay GeoJSON + ice edge + optional nav warnings / GFW layers on the map
4. Alerts panel is present but incidents are not yet served from the live API
