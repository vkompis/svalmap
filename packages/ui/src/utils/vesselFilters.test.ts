import assert from 'node:assert/strict';
import {
  DEFAULT_VESSEL_FILTERS,
  vesselPassesFilter,
  vesselFiltersFromUrlTokens,
  mergeVesselFilters,
} from './vesselFilters.ts';

const all = { ...DEFAULT_VESSEL_FILTERS };

assert.equal(
  vesselPassesFilter({ category: 'norway', flagCountry: 'norway' }, all),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway' },
    { ...all, norway: false }
  ),
  false
);
assert.equal(
  vesselPassesFilter(
    { category: 'eu', flagCountry: 'eu' },
    { ...all, norway: false }
  ),
  true
);

// Priority types ignore country toggles
assert.equal(
  vesselPassesFilter(
    { category: 'military', flagCountry: 'norway', military: 1 },
    { ...all, norway: false }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'military', flagCountry: 'norway', military: 1 },
    { ...all, norway: false, military: false }
  ),
  false
);
assert.equal(
  vesselPassesFilter(
    { category: 'research', flagCountry: 'russia', research: 1 },
    { ...all, russia: false }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'research', flagCountry: 'russia', research: 1 },
    { ...all, russia: true, research: false }
  ),
  false
);
assert.equal(
  vesselPassesFilter(
    { category: 'military', flagCountry: 'eu', military: 1 },
    { ...all, military: false }
  ),
  false
);

// Civilian still follows country even when types are on
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway' },
    { ...all, norway: false, military: true, research: true }
  ),
  false
);

assert.equal(
  vesselPassesFilter(
    { category: 'rest', flagCountry: 'rest', sanctioned: 1 },
    { ...all, sanctioned: true }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'rest', flagCountry: 'rest', sanctioned: 0 },
    { ...all, sanctioned: true }
  ),
  false
);
// Focus still applies to military
assert.equal(
  vesselPassesFilter(
    {
      category: 'military',
      flagCountry: 'norway',
      military: 1,
      sanctioned: 0,
    },
    { ...all, norway: false, sanctioned: true }
  ),
  false
);
assert.equal(
  vesselPassesFilter(
    {
      category: 'military',
      flagCountry: 'norway',
      military: 1,
      sanctioned: 1,
    },
    { ...all, norway: false, sanctioned: true }
  ),
  true
);

// Ship type bucket (AND with country)
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway', shipClass: 'fishing' },
    { ...all, fishing: false }
  ),
  false
);
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway', shipType: 'Cargo' },
    { ...all, fishing: false }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway', shipType: 'Not available' },
    { ...all, unknown: false }
  ),
  false
);

// recent 6h
const now = Date.parse('2026-09-26T12:00:00Z');
assert.equal(
  vesselPassesFilter(
    {
      category: 'norway',
      flagCountry: 'norway',
      timestamp: '2026-09-26T10:00:00Z',
    },
    { ...all, recent6h: true },
    { nowMs: now }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    {
      category: 'norway',
      flagCountry: 'norway',
      timestamp: '2026-09-26T01:00:00Z',
    },
    { ...all, recent6h: true },
    { nowMs: now }
  ),
  false
);

// watchlist only
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway', mmsi: '257000001' },
    { ...all, watchlistOnly: true },
    { watchlistMmsis: new Set(['257000001']) }
  ),
  true
);
assert.equal(
  vesselPassesFilter(
    { category: 'norway', flagCountry: 'norway', mmsi: '257000002' },
    { ...all, watchlistOnly: true },
    { watchlistMmsis: new Set(['257000001']) }
  ),
  false
);

// Legacy exclusive URL token must not hide everyone
assert.deepEqual(vesselFiltersFromUrlTokens(['russian']), all);
assert.equal(vesselFiltersFromUrlTokens(['-norway']).norway, false);
assert.equal(vesselFiltersFromUrlTokens(['-norway']).russia, true);
assert.equal(vesselFiltersFromUrlTokens(['-fishing', 'age6']).fishing, false);
assert.equal(vesselFiltersFromUrlTokens(['-fishing', 'age6']).recent6h, true);

// Legacy prefs shape → defaults (show all)
assert.deepEqual(
  mergeVesselFilters({ russian: true, exclusive: true }),
  all
);

console.log('vesselFilters.test.ts: ok');
