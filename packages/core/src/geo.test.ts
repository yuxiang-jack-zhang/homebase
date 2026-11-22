import { describe, expect, it } from 'vitest';
import { distanceMeters, isInsideHome } from './geo.ts';

describe('geo', () => {
  it('distanceMeters: Ferry Building to Coit Tower is about 1300 m', () => {
    const d = distanceMeters({ lat: 37.7955, lng: -122.3937 }, { lat: 37.8024, lng: -122.4058 });
    expect(Math.abs(d - 1300)).toBeLessThanOrEqual(50);
  });
  const home = { lat: 37, lng: -122, radiusM: 100 };
  // 1 deg latitude = ~111195 m on this sphere
  const north = (m: number) => ({ lat: 37 + m / 111194.93, lng: -122 });
  it('isInsideHome is true at 99 m', () => expect(isInsideHome(home, north(99))).toBe(true));
  it('isInsideHome is false at 101 m', () => expect(isInsideHome(home, north(101))).toBe(false));
});
