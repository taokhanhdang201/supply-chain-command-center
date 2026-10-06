import { describe, it, expect } from 'vitest';
import { haversineMiles, projectToMap } from '../../src/shared/geo';
import { LOCATIONS } from '../../src/shared/reference/locations';
import { US_OUTLINE } from '../../src/shared/reference/usOutline';

describe('haversineMiles', () => {
  it('computes DFW to Houston distance within 10 miles of the known ~238 mi', () => {
    const dfw = { lat: 32.9, lon: -97.04 };
    const hou = { lat: 29.76, lon: -95.37 };
    expect(haversineMiles(dfw, hou)).toBeGreaterThan(228);
    expect(haversineMiles(dfw, hou)).toBeLessThan(248);
  });

  it('is zero for identical points', () => {
    expect(haversineMiles({ lat: 10, lon: 10 }, { lat: 10, lon: 10 })).toBe(0);
  });
});

describe('projectToMap', () => {
  it('projects every US_OUTLINE point within the 0..1000 x 0..600 viewBox', () => {
    for (const [lon, lat] of US_OUTLINE) {
      const { x, y } = projectToMap(lat, lon);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it('projects every reference LOCATION within the 0..1000 x 0..600 viewBox', () => {
    for (const loc of LOCATIONS) {
      const { x, y } = projectToMap(loc.lat, loc.lon);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });
});
