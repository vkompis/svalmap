// Map components
export { default as MapContainer } from './components/MapContainer';
export { default as VesselLayer } from './components/VesselLayer';
export type { VesselFeatureProps } from './components/VesselLayer';
export {
  mmsiCategory,
  countryInfoFromMmsi,
  HEADER_COLORS,
  headerTextColor,
  navStatusLabel,
} from './utils/vesselCategory';
export type { VesselCategory } from './utils/vesselCategory';
export { default as OverlayLayers } from './components/OverlayLayers';
export type { OverlayVisibility } from './components/OverlayLayers';
export { default as GfwLayers } from './components/GfwLayers';
export type { GfwVisibility } from './components/GfwLayers';
export { default as IncidentLayer } from './components/IncidentLayer';
export { default as RestrictedAreaLayer } from './components/RestrictedAreaLayer';

// UI components
export { default as VesselMarker } from './components/VesselMarker';
export { default as IncidentMarker } from './components/IncidentMarker';
export { default as AlertPanel } from './components/AlertPanel';
export { default as VesselInfo } from './components/VesselInfo';

// Hooks
export { useMap } from './hooks/useMap';
