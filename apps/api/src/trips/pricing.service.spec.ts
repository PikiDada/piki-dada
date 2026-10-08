import axios from 'axios';
import { RideType } from '@prisma/client';
import { PricingService } from './pricing.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const BODA_RULE = {
  rideType: RideType.BODA,
  baseFare: 1500,
  perKm: 500,
  perMinute: 50,
  waitingPerMinute: 200,
  freeWaitMinutes: 5,
  currency: 'UGX',
};

const DEFAULT_SETTINGS = {
  fareRoundingUnit: 500,
  roadDistanceFallbackFactor: 1.3,
  averageSpeedKmh: 28,
};

function makeService(
  env: Record<string, string> = {},
  mapsRoute?: { distanceKm: number; durationMin: number },
  settings: Partial<typeof DEFAULT_SETTINGS> = {},
  durationFactor = 1,
) {
  const prisma = {
    pricingRule: {
      findUnique: jest.fn().mockResolvedValue(BODA_RULE),
      create: jest.fn(),
    },
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const maps = {
    enabled: !!mapsRoute,
    route: jest.fn().mockResolvedValue(mapsRoute ?? null),
  };
  const pricingSettings = {
    get: jest.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, ...settings }),
  };
  const accuracy = {
    durationFactor: jest.fn().mockResolvedValue(durationFactor),
  };
  const service = new PricingService(
    prisma as never,
    config as never,
    maps as never,
    pricingSettings as never,
    accuracy as never,
  );
  return { service, maps, accuracy };
}

const pickup = { lat: 0.3136, lng: 32.5811 };
const stop = { lat: 0.3354, lng: 32.5695 };
const destination = { lat: 0.3621, lng: 32.6193 };

describe('PricingService with stops', () => {
  afterEach(() => jest.clearAllMocks());

  it('prices with Google and keeps the maps platform answer as a shadow quote', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { routes: [{ distanceMeters: 9000, duration: '1200s' }] },
    });
    const { service, maps } = makeService(
      { GOOGLE_ROUTES_API_KEY: 'key' },
      { distanceKm: 12, durationMin: 25 },
    );

    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );

    expect(estimate.distanceKm).toBe(9);
    expect(estimate.routeSource).toBe('GOOGLE');
    expect(maps.route).toHaveBeenCalledWith([pickup, destination]);
    expect(estimate.mapsDistanceKm).toBe(12);
    expect(estimate.mapsDurationMin).toBe(25);
  });

  it("scales Google's duration by the learned correction", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { routes: [{ distanceMeters: 9000, duration: '1200s' }] },
    });
    const { service } = makeService(
      { GOOGLE_ROUTES_API_KEY: 'key' },
      undefined,
      {},
      1.5,
    );

    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );

    expect(estimate.durationMin).toBe(30);
    expect(estimate.durationFactor).toBe(1.5);
  });

  it('never corrects a duration that did not come from Google', async () => {
    const { service, accuracy } = makeService({}, undefined, {}, 1.5);
    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );
    expect(estimate.durationFactor).toBe(1);
    expect(accuracy.durationFactor).not.toHaveBeenCalled();
  });

  it('says when the fare came from the straight-line fallback', async () => {
    const { service } = makeService();
    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );
    expect(estimate.routeSource).toBe('STRAIGHT_LINE');
    expect(estimate.mapsDistanceKm).toBeNull();
  });

  it('falls back to the maps platform, with the whole route in visiting order', async () => {
    const { service, maps } = makeService(
      {},
      { distanceKm: 12, durationMin: 25 },
    );

    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
      [stop],
    );

    expect(maps.route).toHaveBeenCalledWith([pickup, stop, destination]);
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
    expect(estimate.distanceKm).toBe(12);
    expect(estimate.durationMin).toBe(25);
    expect(estimate.routeSource).toBe('MAPS_PLATFORM');
  });

  it('passes stops to Google Routes as intermediates', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { routes: [{ distanceMeters: 12000, duration: '1500s' }] },
    });
    const { service } = makeService({ GOOGLE_ROUTES_API_KEY: 'key' });

    await service.estimateFare(RideType.BODA, pickup, destination, [stop]);

    const body = mockedAxios.post.mock.calls[0][1] as {
      intermediates: { location: { latLng: object } }[];
    };
    expect(body.intermediates).toEqual([
      { location: { latLng: { latitude: stop.lat, longitude: stop.lng } } },
    ]);
  });

  it('sums each leg for the straight-line fallback', async () => {
    const { service } = makeService();
    const direct = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );
    const viaStop = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
      [stop],
    );

    const legs =
      service.haversineDistanceKm(pickup, stop) +
      service.haversineDistanceKm(stop, destination);
    expect(viaStop.distanceKm).toBeCloseTo(legs * 1.3, 1);
    expect(viaStop.distanceKm).toBeGreaterThan(direct.distanceKm);
  });

  it("uses the admin's fallback factor and rounding unit", async () => {
    const { service } = makeService({}, undefined, {
      roadDistanceFallbackFactor: 2,
      fareRoundingUnit: 1000,
    });
    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );

    const straight = service.haversineDistanceKm(pickup, destination);
    expect(estimate.distanceKm).toBeCloseTo(straight * 2, 1);
    expect(estimate.fare % 1000).toBe(0);
  });

  it("returns the ride type's waiting rates so the trip can lock them in", async () => {
    const { service } = makeService();
    const estimate = await service.estimateFare(
      RideType.BODA,
      pickup,
      destination,
    );
    expect(estimate.waitingPerMinute).toBe(200);
    expect(estimate.freeWaitMinutes).toBe(5);
  });

  describe('waitingFee', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 9, minute));
    const booked = { waitingPerMinute: 100, freeWaitMinutes: 3 };

    it('charges per minute beyond the free minutes, rounded to the admin unit', async () => {
      const { service } = makeService();
      // 13 minutes waited -> 10 billable x 100 UGX = 1,000
      const fee = await service.waitingFee(booked, [
        { arrivedAt: at(0), departedAt: at(13) },
      ]);
      expect(fee).toBe(1000);
    });

    it('uses the free minutes the trip was booked with', async () => {
      const { service } = makeService();
      const fee = await service.waitingFee(
        { waitingPerMinute: 100, freeWaitMinutes: 15 },
        [{ arrivedAt: at(0), departedAt: at(13) }],
      );
      expect(fee).toBe(0);
    });

    it('is free when the rate is zero', async () => {
      const { service } = makeService();
      const fee = await service.waitingFee(
        { waitingPerMinute: 0, freeWaitMinutes: 0 },
        [{ arrivedAt: at(0), departedAt: at(30) }],
      );
      expect(fee).toBe(0);
    });

    it('does not charge a stop the driver never left', async () => {
      const { service } = makeService();
      const fee = await service.waitingFee(booked, [
        { arrivedAt: at(0), departedAt: null },
      ]);
      expect(fee).toBe(0);
    });
  });
});
