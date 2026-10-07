import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  const queryRaw = jest.fn<Promise<unknown>, []>();

  beforeEach(async () => {
    queryRaw.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  // Render and the keep-alive workflow treat a failing /health as "service down", so it must
  // reflect whether the database is actually reachable, not just that Node is running.
  describe('health', () => {
    it('reports ok when the database answers', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
      });
    });

    it('fails when the database is unreachable', async () => {
      queryRaw.mockRejectedValue(new Error('connection refused'));
      await expect(appController.getHealth()).rejects.toThrow(
        'connection refused',
      );
    });
  });
});
