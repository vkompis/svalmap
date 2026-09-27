// Map components
export { default as MapContainer } from './components/MapContainer';
export { default as VesselLayer } from './components/VesselLayer';
export type { VesselFeatureProps, VesselLayerStatus } from './components/VesselLayer';
export {
  mmsiCategory,
  mmsiFlagCountry,
  countryInfoFromMmsi,
  HEADER_COLORS,
  headerTextColor,
  navStatusLabel,
  isRussianResearchVessel,
  RUSSIAN_RESEARCH_VESSELS,
  RESEARCH_COLOR,
} from './utils/vesselCategory';
export type { VesselCategory, FlagCountry } from './utils/vesselCategory';
export { default as OverlayLayers } from './components/OverlayLayers';
export type { OverlayVisibility, CableFeatureProps, PortFeatureProps, RigFeatureProps, PipelineFeatureProps } from './components/OverlayLayers';
export { default as GfwLayers } from './components/GfwLayers';
export {
  SAR_MATCHED_FLAG_OPTIONS,
  matchedSarLayerFilter,
} from './components/GfwLayers';
export type { GfwVisibility, GfwEventProps } from './components/GfwLayers';
export { default as IncidentLayer } from './components/IncidentLayer';
export type { NavWarningProps } from './components/IncidentLayer';
export { default as RestrictedAreaLayer } from './components/RestrictedAreaLayer';
export { default as AoiDrawLayer } from './components/AoiDrawLayer';

export {
  ALERT_AREAS,
  ALERTS_STORAGE_KEY,
  createAlertRule,
  loadAlertRules,
  saveAlertRules,
  areaLabel,
  parseMmsiList,
  ruleWatchSummary,
} from './utils/areaAlerts';
export type {
  AlertAreaId,
  AreaAlertRule,
  AlertAreaDef,
  AlertPolygon,
} from './utils/areaAlerts';
export { pointInGeoJSON, pointInGeometry } from './utils/geo';

// UI components
export { default as VesselMarker } from './components/VesselMarker';
export { default as IncidentMarker } from './components/IncidentMarker';
export { default as AlertPanel } from './components/AlertPanel';
export { default as ShipPhoto, shipInfoPhotoUrl, shipInfoPageUrl } from './components/ShipPhoto';
export { default as VesselInfo } from './components/VesselInfo';

export { default as VesselSearch } from './components/VesselSearch';
export type { VesselSearchHit } from './components/VesselSearch';
export { default as WatchlistPanel } from './components/WatchlistPanel';
export { default as LiveIncidentsPanel } from './components/LiveIncidentsPanel';
export type { LiveIncident } from './components/LiveIncidentsPanel';
export {
  DEFAULT_VESSEL_FILTERS,
  anyFilterActive,
  vesselFilterExpression,
  vesselPassesFilter,
  mergeVesselFilters,
  vesselFiltersToUrlTokens,
  vesselFiltersFromUrlTokens,
} from './utils/vesselFilters';
export type { VesselFilterFlags, VesselFilterExtras } from './utils/vesselFilters';
export {
  SHIP_CLASS_KEYS,
  SHIP_CLASS_LABELS,
  resolveShipClass,
} from './utils/shipClass';
export type { ShipClass } from './utils/shipClass';
export { buildVesselHoverHtml, formatLatLonDm } from './utils/vesselHover';
export type { VesselHoverInput } from './utils/vesselHover';
export {
  buildProjectionRingFeatures,
  formatProjectionLabel,
  PROJECTION_MINUTES,
} from './utils/projectionRings';
export {
  loadWatchlist,
  saveWatchlist,
  upsertWatchEntry,
  removeWatchEntry,
  setVesselNote,
  WATCHLIST_KEY,
} from './utils/watchlists';
export type { WatchlistState, WatchlistEntry } from './utils/watchlists';
export {
  exportVesselPack,
  exportGeoJSONSnapshot,
  defaultProvenance,
  downloadBlob,
} from './utils/exportPack';
export { parseUrlState, writeUrlState, copyShareUrl } from './utils/urlState';
export type { UrlMapState } from './utils/urlState';

// Hooks
export { useMap } from './hooks/useMap';
