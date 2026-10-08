import { DeliveryStatus, TripStatus } from '@prisma/client';
import { JourneyTrackingService } from './journey-tracking.service';

const here = { lat: 0.3136, lng: 32.5811 };

function setup(trip?: object, delivery?: object, mapsEnabled = true) {
  const prisma = {
    trip: { findUnique: jest.fn().mockResolvedValue(trip ?? null) },
    delivery: { findUnique: jest.fn().mockResolvedValue(delivery ?? null) },
    tripLocationPing: { create: jest.fn() },
    deliveryLocationPing: { create: jest.fn() },
  };
  const maps = { recordPing: jest.fn(), enabled: mapsEnabled };
  const service = new JourneyTrackingService(prisma as never, maps as never);
  return { service, prisma, maps };
}

describe('JourneyTrackingService', () => {
  it('rejects a location from anyone but the assigned driver', async () => {
    const { service, prisma, maps } = setup({
      status: TripStatus.IN_PROGRESS,
      driver: { userId: 'driver-1' },
    });

    const ok = await service.recordDriverLocation(
      'someone-else',
      { tripId: 't1' },
      here,
    );

    expect(ok).toBe(false);
    expect(prisma.tripLocationPing.create).not.toHaveBeenCalled();
    expect(maps.recordPing).not.toHaveBeenCalled();
  });

  it('stores the billed part of a ride and sends it to the maps platform', async () => {
    const { service, prisma, maps } = setup({
      status: TripStatus.IN_PROGRESS,
      driver: { userId: 'driver-1' },
    });

    const ok = await service.recordDriverLocation(
      'driver-1',
      { tripId: 't1' },
      here,
    );

    expect(ok).toBe(true);
    expect(prisma.tripLocationPing.create).toHaveBeenCalledTimes(1);
    expect(maps.recordPing).toHaveBeenCalledWith(
      'trip:t1',
      here,
      expect.any(Date),
    );
  });

  it('keeps the drive to pickup while the maps platform is not running', async () => {
    const { service, prisma } = setup(
      { status: TripStatus.ACCEPTED, driver: { userId: 'driver-1' } },
      undefined,
      false,
    );

    await service.recordDriverLocation('driver-1', { tripId: 't1' }, here);

    expect(prisma.tripLocationPing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tripId: 't1', billed: false }) as unknown,
    });
  });

  it('sends the drive to pickup to the maps platform only', async () => {
    const { service, prisma, maps } = setup({
      status: TripStatus.ACCEPTED,
      driver: { userId: 'driver-1' },
    });

    await service.recordDriverLocation('driver-1', { tripId: 't1' }, here);

    expect(prisma.tripLocationPing.create).not.toHaveBeenCalled();
    expect(maps.recordPing).toHaveBeenCalledTimes(1);
  });

  it('records delivery journeys from the assigned rider', async () => {
    const { service, prisma, maps } = setup(undefined, {
      status: DeliveryStatus.PICKED_UP,
      rider: { userId: 'rider-1' },
    });

    const ok = await service.recordDriverLocation(
      'rider-1',
      { deliveryId: 'd1' },
      here,
    );

    expect(ok).toBe(true);
    expect(maps.recordPing).toHaveBeenCalledWith(
      'delivery:d1',
      here,
      expect.any(Date),
    );
    expect(prisma.deliveryLocationPing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveryId: 'd1',
        billed: true,
      }) as unknown,
    });
  });

  it('keeps at most one point every 3 seconds per journey', async () => {
    const { service, maps } = setup({
      status: TripStatus.IN_PROGRESS,
      driver: { userId: 'driver-1' },
    });

    await service.recordDriverLocation('driver-1', { tripId: 't1' }, here);
    const ok = await service.recordDriverLocation(
      'driver-1',
      { tripId: 't1' },
      here,
    );

    expect(ok).toBe(true);
    expect(maps.recordPing).toHaveBeenCalledTimes(1);
  });
});
