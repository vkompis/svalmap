/** Citeable export packs for OSINT (client-side, free). */

export type ProvenanceBlock = {
  tool: string;
  exportedAt: string;
  sources: string[];
  attribution: string;
  note?: string;
};

export function defaultProvenance(extraSources: string[] = []): ProvenanceBlock {
  return {
    tool: 'SvalMap',
    exportedAt: new Date().toISOString(),
    sources: [
      'AISStream live AIS',
      'BarentsWatch AIS (live + historic ≤14d)',
      'DMA / OpenSanctions / local CSVs (sanctions & shadow)',
      'Global Fishing Watch events API',
      'Kystverket navigation warnings',
      ...extraSources,
    ],
    attribution:
      'Export for research use. Verify against primary sources before publication. AIS positions are self-reported.',
  };
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportVesselPack(opts: {
  vessel: Record<string, unknown>;
  track?: { line?: any; points?: any; meta?: any } | null;
  sanctions?: Record<string, unknown> | null;
  note?: string | null;
}) {
  const provenance = defaultProvenance(
    opts.track ? [`BarentsWatch historic track (${opts.track.meta?.days || 1}d)`] : []
  );
  const pack = {
    type: 'svalmap.vessel-pack',
    version: 1,
    provenance,
    vessel: opts.vessel,
    track: opts.track || null,
    sanctions: opts.sanctions || null,
    analystNote: opts.note || null,
  };
  const mmsi = String(opts.vessel.mmsi || 'unknown');
  const stamp = provenance.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  downloadBlob(
    `svalmap-vessel-${mmsi}-${stamp}.json`,
    new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
  );

  // CSV of track points if present
  const pts = opts.track?.points?.features;
  if (Array.isArray(pts) && pts.length) {
    const rows = [['time', 'lon', 'lat', 'speed', 'course', 'heading']];
    for (const f of pts) {
      const [lon, lat] = f.geometry?.coordinates || [];
      const p = f.properties || {};
      rows.push([
        p.time || '',
        String(lon ?? ''),
        String(lat ?? ''),
        p.speed ?? '',
        p.course ?? '',
        p.heading ?? '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(
      `svalmap-track-${mmsi}-${stamp}.csv`,
      new Blob([csv], { type: 'text/csv' })
    );
  }
}

export function exportGeoJSONSnapshot(opts: {
  vessels: Array<{ type: string; geometry: any; properties: any }>;
  label?: string;
}) {
  const provenance = defaultProvenance();
  const fc = {
    type: 'FeatureCollection',
    features: opts.vessels,
    properties: { provenance, label: opts.label || 'live vessels' },
  };
  const stamp = provenance.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  downloadBlob(
    `svalmap-vessels-${stamp}.geojson`,
    new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' })
  );
}
