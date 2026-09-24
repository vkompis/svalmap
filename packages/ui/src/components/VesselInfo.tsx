import React from 'react';

type Props = { mmsi: string };

export default function VesselInfo({ mmsi }: Props) {
  return (
    <div className="text-xs text-gray-700">MMSI: {mmsi}</div>
  );
}


