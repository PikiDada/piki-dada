import {
  correctionFactor,
  type AccuracyRow,
} from './estimate-accuracy.service';
import { bandAt } from '../common/time-bands';

const settings = {
  durationCorrectionEnabled: true,
  durationCorrectionMinTrips: 30,
  durationCorrectionMax: 2,
};

const row = (trips: number, durationRatio: number | null): AccuracyRow => ({
  kind: 'ECONOMY',
  band: 4,
  trips,
  durationRatio,
  distanceRatio: 1,
  mapsTrips: 0,
  mapsDurationRatio: null,
  mapsDistanceRatio: null,
});

describe('correctionFactor', () => {
  it('uses what the trips show once there are enough of them', () => {
    expect(correctionFactor(row(40, 1.6), settings)).toBe(1.6);
  });

  it('stays at 1 until there are enough trips to trust', () => {
    expect(correctionFactor(row(29, 1.6), settings)).toBe(1);
    expect(correctionFactor(undefined, settings)).toBe(1);
  });

  it("never goes past the admin's cap, either way", () => {
    expect(correctionFactor(row(40, 3.4), settings)).toBe(2);
    expect(correctionFactor(row(40, 0.2), settings)).toBe(0.5);
  });
});

describe('bandAt', () => {
  it('uses Kampala time', () => {
    // 15:30 UTC = 18:30 in Kampala: evening rush.
    expect(bandAt(new Date('2026-10-08T15:30:00Z'))).toBe(4);
    // 02:59 UTC = 05:59: still night. 03:00 UTC = 06:00: morning rush.
    expect(bandAt(new Date('2026-10-08T02:59:00Z'))).toBe(1);
    expect(bandAt(new Date('2026-10-08T03:00:00Z'))).toBe(2);
  });
});
