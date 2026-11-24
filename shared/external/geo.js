'use strict';

// Real external integration: OpenStreetMap Nominatim converts a venue/place
// into coordinates so "drives near me" and map links work. Results are cached
// in our database so we do not call the public API repeatedly.
const { config } = require('../config');
const { getStore, now } = require('../context');
const { unavailable } = require('../errors');

function distanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(place) {
  if (!place || typeof place !== 'string') return null;
  const query = place.trim().toLowerCase();
  const cacheKey = query.replace(/[^a-z0-9]+/g, '_').slice(0, 100);
  const cached = await getStore().get('bdo_geocodes', cacheKey);
  if (cached) return cached;

  if (config().testMode) {
    // Deterministic local fake used only by automated tests.
    const fake = { lat: 29.37 + (query.length % 5) / 100, lon: 47.98 + (query.length % 7) / 100, label: place, source: 'test' };
    await getStore().put('bdo_geocodes', { id: cacheKey, ...fake, fetchedAt: now() });
    return fake;
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', place);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'BDO-Cloud-Project/1.0 (class project)', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const result = {
      lat: Number(rows[0].lat),
      lon: Number(rows[0].lon),
      label: rows[0].display_name || place,
      source: 'nominatim'
    };
    await getStore().put('bdo_geocodes', { id: cacheKey, ...result, fetchedAt: now() });
    return result;
  } catch (error) {
    console.warn('GEOCODE_FAILED', error.message);
    return null;
  }
}

module.exports = { geocode, distanceKm };
