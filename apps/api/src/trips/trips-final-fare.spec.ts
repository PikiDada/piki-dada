import { RideType, UnvisitedStopsPolicy } from '@prisma/client';
import { TripsService } from './trips.service';

// finalizeFare decides what a passenger pays when a trip ends; tested directly because it
// runs inside the completion flow, which otherwise needs payments, email and sockets mocked.

const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 9, minute));

const trip = {
  id: 't1',
  rideType: RideType.BODA,
  fare: 10000,
  pickupLat: 0.31,
  pickupLng: 32.58,
  destinationLat: 0.36,
  destinationLng: 32.62,
  waitingPerMinute: 100,
  freeWaitMinutes: 3,
  discount: 0,
};

type CouponLike = {
  discountAmount: number | null;
  discountPercent: number | null;
};

interface Stop {
  lat: number;
  lng: number;
  arrivedAt: Date | null;
  departedAt: Date | null;
}
type LatLng = { lat: number; lng: number };

function setup(
  policy: UnvisitedStopsPolicy,
  stops: Stop[],
  repricedFare = 7000,
  waitingFee = 0,
  coupon: CouponLike | null = null,
) {
  const prisma = {
    tripStop: {
      updateMany: jest.fn(),
      findMany: jest.fn<Promise<Stop[]>, []>().mockResolvedValue(stops),
    },
    trip: {
      update: jest.fn<
        Promise<unknown>,
        [{ data: { fare: number; discount?: number } }]
      >(),
    },
  };
  const pricing = {
    settings: jest
      .fn<
        Promise<{
          unvisitedStopsPolicy: UnvisitedStopsPolicy;
          fareRoundingUnit: number;
        }>,
        []
      >()
      .mockResolvedValue({
        unvisitedStopsPolicy: policy,
        fareRoundingUnit: 500,
      }),
    estimateFare: jest
      .fn<Promise<{ fare: number }>, [RideType, LatLng, LatLng, Stop[]]>()
      .mockResolvedValue({ fare: repricedFare }),
    waitingFee: jest
      .fn<Promise<number>, [typeof trip, Stop[]]>()
      .mockResolvedValue(waitingFee),
  };
  const coupons = {
    couponFor: jest
      .fn<Promise<CouponLike | null>, []>()
      .mockResolvedValue(coupon),
  };
  const service = new TripsService(
    prisma as never,
    pricing as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coupons as never,
  );
  const internals = service as unknown as {
    finalizeFare: (t: typeof trip, d: Date) => Promise<number>;
  };
  const finalize = (t: typeof trip, d: Date) => internals.finalizeFare(t, d);
  return { finalize, prisma, pricing };
}

const reached = { lat: 0.33, lng: 32.57, arrivedAt: at(5), departedAt: at(10) };
const skipped = { lat: 0.35, lng: 32.6, arrivedAt: null, departedAt: null };

describe('TripsService.finalizeFare', () => {
  it('drops skipped stops from the fare when the policy says so', async () => {
    const { finalize, pricing, prisma } = setup(
      UnvisitedStopsPolicy.REMOVE_FROM_FARE,
      [reached, skipped],
    );

    expect(await finalize(trip, at(30))).toBe(7000);
    // Re-priced through the reached stop only.
    expect(pricing.estimateFare.mock.calls[0][3]).toEqual([reached]);
    expect(prisma.trip.update.mock.calls[0][0].data.fare).toBe(7000);
  });

  it('never charges more than the quote for skipping a stop', async () => {
    const { finalize } = setup(
      UnvisitedStopsPolicy.REMOVE_FROM_FARE,
      [reached, skipped],
      12000,
    );
    expect(await finalize(trip, at(30))).toBe(10000);
  });

  it('keeps the quoted fare when the policy is to charge it', async () => {
    const { finalize, pricing } = setup(UnvisitedStopsPolicy.CHARGE_QUOTED, [
      reached,
      skipped,
    ]);
    expect(await finalize(trip, at(30))).toBe(10000);
    expect(pricing.estimateFare.mock.calls).toHaveLength(0);
  });

  it('adds waiting time at the rates the trip was booked under', async () => {
    const { finalize, pricing } = setup(
      UnvisitedStopsPolicy.REMOVE_FROM_FARE,
      [reached],
      7000,
      1500,
    );
    expect(await finalize(trip, at(30))).toBe(11500);
    expect(pricing.waitingFee.mock.calls[0][0]).toMatchObject({
      waitingPerMinute: 100,
      freeWaitMinutes: 3,
    });
  });

  it('takes the coupon off a fare re-priced for skipped stops', async () => {
    // Re-priced at 7,000; 10% off = 6,300, rounded down to 6,000.
    const { finalize, prisma } = setup(
      UnvisitedStopsPolicy.REMOVE_FROM_FARE,
      [reached, skipped],
      7000,
      0,
      { discountAmount: null, discountPercent: 10 },
    );
    expect(
      await finalize({ ...trip, fare: 9000, discount: 1000 }, at(30)),
    ).toBe(6000);
    expect(prisma.trip.update.mock.calls[0][0].data).toMatchObject({
      fare: 6000,
      discount: 1000,
    });
  });

  it('leaves a trip with no stops at its quote', async () => {
    const { finalize, prisma } = setup(
      UnvisitedStopsPolicy.REMOVE_FROM_FARE,
      [],
    );
    expect(await finalize(trip, at(30))).toBe(10000);
    expect(prisma.trip.update.mock.calls).toHaveLength(0);
  });
});
