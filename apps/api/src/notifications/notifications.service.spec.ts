import { NotificationsService } from './notifications.service';

// Every caller fires notifyUser without awaiting it, so a rejection would be unhandled and
// shut the API process down. It must swallow (and log) its own failures.
describe('NotificationsService.notifyUser', () => {
  it('never rejects, even when saving the notification fails', async () => {
    const prisma = {
      notification: {
        create: jest
          .fn<Promise<unknown>, []>()
          .mockRejectedValue(new Error('database down')),
      },
      user: {
        findUnique: jest.fn<Promise<unknown>, []>().mockResolvedValue(null),
      },
    };
    const push = { sendToToken: jest.fn<Promise<void>, []>() };
    const service = new NotificationsService(prisma as never, push as never);

    await expect(
      service.notifyUser('u1', 'Title', 'Body'),
    ).resolves.toBeUndefined();
  });

  it('never rejects when the push provider fails', async () => {
    const prisma = {
      notification: {
        create: jest.fn<Promise<unknown>, []>().mockResolvedValue({}),
      },
      user: {
        findUnique: jest
          .fn<Promise<unknown>, []>()
          .mockResolvedValue({ fcmToken: 't' }),
      },
    };
    const push = {
      sendToToken: jest
        .fn<Promise<void>, []>()
        .mockRejectedValue(new Error('FCM down')),
    };
    const service = new NotificationsService(prisma as never, push as never);

    await expect(
      service.notifyUser('u1', 'Title', 'Body'),
    ).resolves.toBeUndefined();
  });
});
