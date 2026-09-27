'use client';

import {
  MapContainer,
  VesselLayer,
  OverlayLayers,
  GfwLayers,
  IncidentLayer,
  AoiDrawLayer,
  type OverlayVisibility,
  type GfwVisibility,
  type VesselFeatureProps,
  type GfwEventProps,
  type VesselLayerStatus,
  type CableFeatureProps,
  type PortFeatureProps,
  type RigFeatureProps,
  type PipelineFeatureProps,
  type NavWarningProps,
  type AlertPolygon,
  type VesselFilterFlags,
} from '@svalmap/ui';

type Props = {
  mapStyle: string;
  attribution: string;
  maptilerKey?: string;
  overlays: OverlayVisibility;
  gfw: GfwVisibility;
  shipsVisible: boolean;
  selectedMmsi?: string | null;
  vesselFilters?: VesselFilterFlags;
  trackDays?: number;
  watchlistMmsis?: ReadonlySet<string> | string[];
  drawingAoi?: boolean;
  draftRing?: number[][];
  alertPolygons?: { id: string; polygon: AlertPolygon; label?: string }[];
  onDraftPoint?: (lon: number, lat: number) => void;
  onVesselSelect?: (vessel: VesselFeatureProps) => void;
  onGfwEventSelect?: (event: GfwEventProps) => void;
  onCableSelect?: (cable: CableFeatureProps) => void;
  onPortSelect?: (port: PortFeatureProps) => void;
  onRigSelect?: (rig: RigFeatureProps) => void;
  onPipelineSelect?: (pipeline: PipelineFeatureProps) => void;
  onNavWarningSelect?: (warning: NavWarningProps) => void;
  onDeselect?: () => void;
  onVesselStatus?: (status: VesselLayerStatus) => void;
  onVesselsChange?: (vessels: VesselFeatureProps[]) => void;
};

export default function MapCanvas({
  mapStyle,
  attribution,
  maptilerKey,
  overlays,
  gfw,
  shipsVisible,
  selectedMmsi,
  vesselFilters,
  trackDays = 1,
  watchlistMmsis,
  drawingAoi = false,
  draftRing = [],
  alertPolygons = [],
  onDraftPoint,
  onVesselSelect,
  onGfwEventSelect,
  onCableSelect,
  onPortSelect,
  onRigSelect,
  onPipelineSelect,
  onNavWarningSelect,
  onDeselect,
  onVesselStatus,
  onVesselsChange,
}: Props) {
  return (
    <MapContainer
      center={{ latitude: 62, longitude: -15 }}
      zoom={2.8}
      fitNorway
      mapStyle={mapStyle}
      attribution={attribution}
      maptilerKey={maptilerKey}
    >
      <OverlayLayers
        visibility={overlays}
        onCableSelect={onCableSelect}
        onPortSelect={onPortSelect}
        onRigSelect={onRigSelect}
        onPipelineSelect={onPipelineSelect}
      />
      <IncidentLayer
        showActive={overlays.navwarnings}
        showRecent30d={overlays['navwarnings-30d']}
        interactive={!drawingAoi}
        onWarningSelect={drawingAoi ? undefined : onNavWarningSelect}
      />
      <VesselLayer
        visible={shipsVisible && !drawingAoi}
        interactive={!drawingAoi}
        selectedMmsi={selectedMmsi}
        filters={vesselFilters}
        trackDays={trackDays}
        watchlistMmsis={watchlistMmsis}
        onVesselSelect={drawingAoi ? undefined : onVesselSelect}
        onDeselect={drawingAoi ? undefined : onDeselect}
        onStatus={onVesselStatus}
        onVesselsChange={onVesselsChange}
      />
      <GfwLayers
        visibility={gfw}
        onEventSelect={drawingAoi ? undefined : onGfwEventSelect}
      />
      <AoiDrawLayer
        active={drawingAoi}
        draftRing={draftRing}
        polygons={alertPolygons}
        onMapClick={onDraftPoint}
      />
    </MapContainer>
  );
}
