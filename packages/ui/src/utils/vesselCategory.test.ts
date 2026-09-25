import assert from 'node:assert/strict';
import {
  HEADER_COLORS,
  headerTextColor,
  mmsiCategory,
  countryInfoFromMmsi,
  navStatusLabel,
  isMilitaryShipType,
} from './vesselCategory.ts';

/** Colors must match data/source/Mapmarkers SVG fills */
assert.equal(HEADER_COLORS.norway, '#ff4040');
assert.equal(HEADER_COLORS.russia, '#7dacff');
assert.equal(HEADER_COLORS.eu, '#2b2bcc');
assert.equal(HEADER_COLORS.china, '#f2c403');
assert.equal(HEADER_COLORS.military, '#2b6206');
assert.equal(HEADER_COLORS.research, '#d946ef');
assert.equal(HEADER_COLORS.rest, '#f7f7f7');

assert.equal(headerTextColor('rest'), '#111');
assert.equal(headerTextColor('norway'), '#fff');

assert.equal(mmsiCategory('259000001'), 'norway');
assert.equal(mmsiCategory('273000001'), 'russia');
assert.equal(mmsiCategory('211000001'), 'eu');
assert.equal(mmsiCategory('412000001'), 'china');
assert.equal(mmsiCategory('366000001'), 'rest');
assert.equal(mmsiCategory('259000001', 35), 'military');
assert.equal(mmsiCategory('259000001', 'Military ops'), 'military');
assert.equal(mmsiCategory('259000001', 55), 'military');
assert.equal(mmsiCategory('273546520'), 'research'); // Yantar
assert.equal(mmsiCategory('273359440', null, '9548536'), 'research'); // Tryoshnikov
assert.ok(isMilitaryShipType('Law enforcement'));

assert.equal(countryInfoFromMmsi('273123456').iso, 'ru');
assert.equal(countryInfoFromMmsi('257123456').name, 'Norway');

assert.equal(navStatusLabel(0), 'Under way using engine');
assert.equal(navStatusLabel(7), 'Engaged in fishing');
assert.equal(navStatusLabel(null), 'Not available');
assert.equal(navStatusLabel(''), 'Not available');

console.log('vesselCategory.test.ts: ok');
