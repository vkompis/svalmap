'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { OverlayVisibility, GfwVisibility, VesselFeatureProps } from '@svalmap/ui';
import { HEADER_COLORS, headerTextColor, navStatusLabel } from '@svalmap/ui';

const MapCanvas = dynamic(() => import('./MapCanvas'), { ssr: false });

const DEFAULT_OVERLAYS: OverlayVisibility = {
  'eez-norway': false,
  'eez-janmayen': false,
  'eez-svalbard': true,
  cables: false,
  petroleum: false,
  nsm: false,
  skytefelt: false,
  ports: false,
  airports: false,
};

const DEFAULT_GFW: GfwVisibility = {
  loitering: false,
  encounters: false,
  aisoff: false,
  port: false,
  sar: false,
  viirs: false,
};

export default function HomePage() {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [eaOpen, setEaOpen] = useState(true);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [selectedVessel, setSelectedVessel] = useState<VesselFeatureProps | null>(null);
  const [shipsVisible, setShipsVisible] = useState(true);
  const [overlays, setOverlays] = useState<OverlayVisibility>(DEFAULT_OVERLAYS);
  const [gfw, setGfw] = useState<GfwVisibility>(DEFAULT_GFW);

  const mapStyle =
    process.env.NEXT_PUBLIC_MAP_STYLE || '/styles/svalmap-dark.json';
  const attribution =
    process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '© OpenStreetMap contributors';

  const setOverlay = (key: keyof OverlayVisibility, on: boolean) => {
    setOverlays((prev) => ({ ...prev, [key]: on }));
  };
  const setGfwFlag = (key: keyof GfwVisibility, on: boolean) => {
    setGfw((prev) => ({ ...prev, [key]: on }));
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="panel">
          <div className="header">
            <span className="title">Maplayers</span>
            <button
              id="collapse-btn"
              onClick={() => setDrawerOpen(!drawerOpen)}
              title="Collapse"
            >
              ⮜
            </button>
          </div>

          <div className="disclaimer">
            NOTE: This map shows all registered vessels inside the Svalbard Fisheries Protection Zone
            except fishing vessels under 15 meters in length and recreational vessels under 45 meters
            in length. Inside The Norwegian and Jan Mayen EEZs only Russian vessels, shadow fleet
            vessels, sanctioned vessels, and military/law enforcement vessels are displayed.
          </div>

          <div className="section">
            <div className="item">
              <div className="label">Economic area</div>
              <button
                id="ea-toggle"
                style={{ background: 'transparent', border: 0, color: '#e2e8f0', cursor: 'pointer' }}
                onClick={() => setEaOpen((v) => !v)}
              >
                Details
              </button>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/EEZs.svg" alt="EEZ" />
            </div>

            <div id="ea-group" className="group" style={{ display: eaOpen ? 'block' : 'none' }}>
              <div className="item">
                <div className="label">Norway EEZ</div>
                <div className="spacer"></div>
                <img className="menu-icon" src="/menu/EEZs.svg" alt="EEZ" />
                <label>
                  <input
                    type="checkbox"
                    checked={overlays['eez-norway']}
                    onChange={(e) => setOverlay('eez-norway', e.target.checked)}
                  />
                </label>
              </div>
              <div className="item">
                <div className="label">Jan Mayen EEZ</div>
                <div className="spacer"></div>
                <img className="menu-icon" src="/menu/EEZs.svg" alt="EEZ" />
                <label>
                  <input
                    type="checkbox"
                    checked={overlays['eez-janmayen']}
                    onChange={(e) => setOverlay('eez-janmayen', e.target.checked)}
                  />
                </label>
              </div>
              <div className="item">
                <div className="label">Svalbard Fisheries Protection Zone</div>
                <div className="spacer"></div>
                <img className="menu-icon" src="/menu/EEZs.svg" alt="EEZ" />
                <label>
                  <input
                    type="checkbox"
                    checked={overlays['eez-svalbard']}
                    onChange={(e) => setOverlay('eez-svalbard', e.target.checked)}
                  />
                </label>
              </div>
            </div>

            <div className="item">
              <div className="label">Undersea cables</div>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/Underseacables.svg" alt="Undersea cables" />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.cables}
                  onChange={(e) => setOverlay('cables', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">Pipelines and oil rigs</div>
              <div className="spacer"></div>
              <img
                className="menu-icon"
                src="/menu/pipelines_and_oil_rigs.svg"
                alt="Pipelines and oil rigs"
              />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.petroleum}
                  onChange={(e) => setOverlay('petroleum', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">NSM restriction areas</div>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/NSMrestriction.svg" alt="NSM restriction areas" />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.nsm}
                  onChange={(e) => setOverlay('nsm', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">Airports</div>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/Airports.svg" alt="Airports" />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.airports}
                  disabled
                  title="Airport GeoJSON not available yet"
                  onChange={(e) => setOverlay('airports', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">Offshore firing range</div>
              <div className="spacer"></div>
              <img
                className="menu-icon"
                src="/menu/Offshore_firing_range.svg"
                alt="Offshore firing range"
              />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.skytefelt}
                  onChange={(e) => setOverlay('skytefelt', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">Ports</div>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/ports.svg" alt="Ports" />
              <label>
                <input
                  type="checkbox"
                  checked={overlays.ports}
                  onChange={(e) => setOverlay('ports', e.target.checked)}
                />
              </label>
            </div>

            <div className="item">
              <div className="label">Ships</div>
              <div className="spacer"></div>
              <img className="menu-icon" src="/menu/Ships.svg" alt="Ships" />
              <label>
                <input
                  type="checkbox"
                  checked={shipsVisible}
                  onChange={(e) => setShipsVisible(e.target.checked)}
                />
              </label>
            </div>

            <div className="section-header">Global Fishing Watch</div>
            <div className="item">
              <div className="label">Loitering events</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.loitering}
                  onChange={(e) => setGfwFlag('loitering', e.target.checked)}
                />
              </label>
            </div>
            <div className="item">
              <div className="label">Encounters / Transshipments</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.encounters}
                  onChange={(e) => setGfwFlag('encounters', e.target.checked)}
                />
              </label>
            </div>
            <div className="item">
              <div className="label">AIS off events</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.aisoff}
                  onChange={(e) => setGfwFlag('aisoff', e.target.checked)}
                />
              </label>
            </div>
            <div className="item">
              <div className="label">Port visits</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.port}
                  onChange={(e) => setGfwFlag('port', e.target.checked)}
                />
              </label>
            </div>
            <div className="item">
              <div className="label">SAR detections (4Wings only — N/A)</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.sar}
                  disabled
                  title="GFW v3 exposes SAR as 4Wings tiles, not point detections"
                  onChange={(e) => setGfwFlag('sar', e.target.checked)}
                />
              </label>
            </div>
            <div className="item">
              <div className="label">VIIRS detections (N/A)</div>
              <div className="spacer"></div>
              <label>
                <input
                  type="checkbox"
                  checked={gfw.viirs}
                  disabled
                  title="VIIRS point detections are not available in GFW API v3"
                  onChange={(e) => setGfwFlag('viirs', e.target.checked)}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="overlay" onClick={() => setDrawerOpen(false)}></div>
      </div>

      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <MapCanvas
          mapStyle={mapStyle}
          attribution={attribution}
          overlays={overlays}
          gfw={gfw}
          shipsVisible={shipsVisible}
          onVesselSelect={(vessel) => {
            setSelectedVessel(vessel);
            setDetailDrawerOpen(true);
          }}
        />
      </div>

      <div id="detail-drawer" className={detailDrawerOpen ? 'open' : ''}>
        <div id="detail-card">
          {selectedVessel && (
            <>
              <div
                className="head"
                style={{
                  background: HEADER_COLORS[selectedVessel.category] || HEADER_COLORS.rest,
                  color: headerTextColor(selectedVessel.category),
                }}
              >
                {selectedVessel.name || `MMSI ${selectedVessel.mmsi}`}
                <div className="country">
                  <img
                    src={`/flag-icons/${selectedVessel.flag || 'xx'}.svg`}
                    alt="flag"
                    style={{ width: '14px', height: '10px' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  {selectedVessel.country || 'Unknown'}
                </div>
                {!!selectedVessel.sanctioned && (
                  <div className="country" style={{ marginTop: 6 }}>
                    <img
                      src="/markers/Circles/Sanksjon.svg"
                      alt="sanction"
                      style={{ width: 16, height: 12 }}
                    />
                    Sanctioned ship
                  </div>
                )}
                {!!selectedVessel.shadowfleet && (
                  <div className="country" style={{ marginTop: 6 }}>
                    <img
                      src="/markers/Circles/shadowtriangle.svg"
                      alt="shadow"
                      style={{ width: 16, height: 12 }}
                    />
                    Russian shadow fleet
                  </div>
                )}
              </div>
              <div className="placeholder">Image placeholder</div>
              <div className="body">
                <div className="row">
                  <span className="k">MMSI:</span>
                  <span className="v">{selectedVessel.mmsi || 'Not available'}</span>
                </div>
                <div className="row">
                  <span className="k">IMO:</span>
                  <span className="v">{selectedVessel.imo || 'Not available'}</span>
                </div>
                <div className="row">
                  <span className="k">Destination:</span>
                  <span className="v">{selectedVessel.destination || 'Not available'}</span>
                </div>
                <div className="row">
                  <span className="k">ETA:</span>
                  <span className="v">{selectedVessel.eta || 'Not available'}</span>
                </div>
                <div className="row">
                  <span className="k">Type:</span>
                  <span className="v">{selectedVessel.shipType || 'Not available'}</span>
                </div>
                <div className="row">
                  <span className="k">Time:</span>
                  <span className="v">
                    {selectedVessel.timestamp
                      ? new Date(selectedVessel.timestamp).toLocaleString()
                      : 'Not available'}
                  </span>
                </div>
                <div className="row">
                  <span className="k">Course:</span>
                  <span className="v">
                    {selectedVessel.course != null ? selectedVessel.course : 'Not available'}
                  </span>
                </div>
                <div className="row">
                  <span className="k">Speed:</span>
                  <span className="v">
                    {selectedVessel.speed != null ? `${selectedVessel.speed} kn` : 'Not available'}
                  </span>
                </div>
                <div className="row">
                  <span className="k">Navigational Status:</span>
                  <span className="v">{navStatusLabel(selectedVessel.status)}</span>
                </div>
                <div className="row">
                  <span className="k">True Heading:</span>
                  <span className="v">
                    {selectedVessel.heading != null ? selectedVessel.heading : 'Not available'}
                  </span>
                </div>
              </div>
            </>
          )}
          <button id="detail-close" onClick={() => setDetailDrawerOpen(false)}>
            ×
          </button>
        </div>
      </div>

      <div id="legend">
        <div className="indicators">
          <div className="item">
            <img
              className="legend-icon shadow"
              src="/markers/Circles/shadowtriangle.svg"
              alt="shadow"
            />
            Russian shadow fleet vessel
          </div>
          <div className="item">
            <img className="legend-icon" src="/markers/Circles/Sanksjon.svg" alt="sanction" />
            Sanctioned / flagged vessel
          </div>
          <div className="item">
            <img className="legend-icon" src="/markers/Circles/Militarycircle.svg" alt="military" />
            Military vessel / Law enforcement
          </div>
        </div>
        <div className="row">
          <div className="item">
            <span className="swatch norway"></span>Norway
          </div>
          <div className="item">
            <span className="swatch russia"></span>Russia
          </div>
          <div className="item">
            <span className="swatch eu"></span>EU
          </div>
          <div className="item">
            <span className="swatch china"></span>China
          </div>
          <div className="item">
            <span className="swatch rest"></span>Rest of world
          </div>
        </div>
      </div>
    </div>
  );
}
