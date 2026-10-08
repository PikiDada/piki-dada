import { measureActualRoute, type TracePoint } from './actual-route';

const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 9, 8, 9, minute, second));

// ~0.0009 degrees of latitude is ~100 m.
const point = (lat: number, minute: number, second = 0): TracePoint => ({
  lat,
  lng: 32.58,
  recordedAt: at(minute, second),
});

describe('measureActualRoute', () => {
  it('sums the distance actually travelled', () => {
    const pings = [point(0.3, 0), point(0.3009, 1), point(0.3018, 2)];
    const { actualDistanceKm } = measureActualRoute(pings, at(0), at(2), []);
    expect(actualDistanceKm).toBeCloseTo(0.2, 1);
  });

  it('ignores GPS wander while standing still', () => {
    // Ten fixes jittering a few metres around one spot, then one real 100 m move.
    const jitter = Array.from({ length: 10 }, (_, i) =>
      point(0.3 + (i % 2) * 0.00005, 0, i * 3),
    );
    const pings = [...jitter, point(0.3009, 1)];
    const { actualDistanceKm } = measureActualRoute(pings, at(0), at(1), []);
    expect(actualDistanceKm).toBeCloseTo(0.1, 1);
  });

  it('skips a fix that would mean an impossible speed', () => {
    // 10 km in 3 seconds, then back on the real path.
    const pings = [point(0.3, 0), point(0.39, 0, 3), point(0.3009, 1)];
    const { actualDistanceKm } = measureActualRoute(pings, at(0), at(1), []);
    expect(actualDistanceKm).toBeCloseTo(0.1, 1);
  });

  it('leaves time spent waiting at stops out of the duration', () => {
    const stops = [{ arrivedAt: at(5), departedAt: at(12) }];
    const { actualDurationMin } = measureActualRoute([], at(0), at(20), stops);
    expect(actualDurationMin).toBe(13);
  });

  it('says nothing about distance from fewer than two fixes', () => {
    const result = measureActualRoute([point(0.3, 0)], null, at(5), []);
    expect(result).toEqual({ actualDistanceKm: null, actualDurationMin: null });
  });
});
