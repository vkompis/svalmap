'use client';

import {
  MapContainer,
  VesselLayer,
  OverlayLayers,
  GfwLayers,
  type OverlayVisibility,
  type GfwVisibility,
  type VesselFeatureProps,
} from '@svalmap/ui';

type Props = {
  mapStyle: string;
  attribution: string;
  overlays: OverlayVisibility;
  gfw: GfwVisibility;
  shipsVisible: boolean;
  onVesselSelect?: (vessel: VesselFeatureProps) => void;
};

export default function MapCanvas({
  mapStyle,
  attribution,
  overlays,
  gfw,
  shipsVisible,
  onVesselSelect,
}: Props) {
  return (
    <MapContainer
      center={{ latitude: 69, longitude: 12 }}
      zoom={3.5}
      fitNorway
      mapStyle={mapStyle}
      attribution={attribution}
    >
      <OverlayLayers visibility={overlays} />
      <VesselLayer visible={shipsVisible} onVesselSelect={onVesselSelect} />
      <GfwLayers visibility={gfw} />
    </MapContainer>
  );
}
