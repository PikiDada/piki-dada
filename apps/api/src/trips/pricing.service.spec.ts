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
  currency: 'UGX',
};

function makeService(
  env: Record<string, string> = {},
  mapsRoute?: { distanceKm: number; durationMin: number },
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
  const service = new PricingService(
    prisma as never,
    config as never,
    maps as never,
  );
  return { service, maps };
}

const pickup = { lat: 0.3136, lng: 32.5811 };
const stop = { lat: 0.3354, lng: 32.5695 };
const destination = { lat: 0.3621, lng: 32.6193 };

describe('PricingService with stops', () => {
  afterEach(() => jest.clearAllMocks());

  it('asks the maps platform for the whole route in visiting order', async () => {
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

  describe('tripWaitingFee', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 9, minute));

    it('charges per minute beyond the 3 free minutes, rounded to 500 UGX', async () => {
      const { service } = makeService();
      // 13 minutes waited -> 10 billable x 50 UGX = 500
      const fee = await service.tripWaitingFee(RideType.BODA, [
        { arrivedAt: at(0), departedAt: at(13) },
      ]);
      expect(fee).toBe(500);
    });

    it('is free within the allowance', async () => {
      const { service } = makeService();
      const fee = await service.tripWaitingFee(RideType.BODA, [
        { arrivedAt: at(0), departedAt: at(3) },
      ]);
      expect(fee).toBe(0);
    });

    it('does not charge a stop the driver never left', async () => {
      const { service } = makeService();
      const fee = await service.tripWaitingFee(RideType.BODA, [
        { arrivedAt: at(0), departedAt: null },
      ]);
      expect(fee).toBe(0);
    });
  });
});
