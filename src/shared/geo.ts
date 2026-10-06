// Great-circle distance and a fixed equirectangular projection used by the schematic route map.

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance between two lat/lon points, in miles. */
export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_MILES * c;
}

/** Projects a lat/lon pair onto the map's `0 0 1000 600` SVG viewBox. */
export function projectToMap(lat: number, lon: number): { x: number; y: number } {
  const x = 20 + ((lon + 125.5) / 59) * 960;
  const y = 20 + ((49.8 - lat) / 25.8) * 560;
  return { x, y };
}
