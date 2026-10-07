import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { UserRole } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// These tests cover the bugs found and fixed in the pre-launch hardening pass:
// self-registration as ADMIN, missing-phone registration, the trip-acceptance race,
// and driver wallet being credited before a cash payment is actually confirmed.
// They run against the real configured DATABASE_URL, same as the rest of this app's dev setup.
// This suite makes a lot of sequential network round-trips to a free-tier Neon instance over
// a residential connection — give every test/hook a generous default rather than tuning each one.
jest.setTimeout(60000);

// Shapes of the responses these tests read; supertest types every body as `any`.
interface AuthBody {
  accessToken: string;
  refreshToken?: string;
  user: { id: string };
}
interface ErrorBody {
  message: string;
}
interface ProfileBody {
  phone: string | null;
}
interface PendingDriverBody {
  id: string;
  userId: string;
}
interface TripRequestBody {
  trip: { id: string };
}
interface WalletBody {
  balance: number;
}

function body<T>(res: { body: unknown }): T {
  return res.body as T;
}

describe('Auth and payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stamp = Date.now();

  beforeAll(async () => {
    // Rate limiting is disabled under NODE_ENV=test via ThrottlerModule's skipIf
    // (see app.module.ts) — Jest sets NODE_ENV=test automatically.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  }, 30000); // Neon's serverless cold-start can exceed Jest's 5s default hook timeout.

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('rejects self-registration with role ADMIN', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `hacker_${stamp}@test.com`,
        password: 'password123',
        name: 'Hacker',
        phone: '0700000099',
        role: 'ADMIN',
      })
      .expect(400);
  });

  it('rejects registration without a phone number', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `nophone_${stamp}@test.com`,
        password: 'password123',
        name: 'No Phone',
        role: 'PASSENGER',
      })
      .expect(400);
  });

  describe('cookie-based refresh token flow', () => {
    function extractRefreshCookie(res: {
      headers: Record<string, unknown>;
    }): string {
      const setCookie = res.headers['set-cookie'] as string[];
      const found = setCookie?.find((c) => c.startsWith('refreshToken='));
      if (!found) throw new Error('refreshToken cookie was not set');
      return found.split(';')[0];
    }

    it('never returns the refresh token in the JSON body, only as an httpOnly cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `cookieflow_${stamp}@test.com`,
          password: 'password123',
          name: 'Cookie Flow',
          phone: '0700000004',
          role: 'PASSENGER',
        })
        .expect(201);

      expect(body<AuthBody>(res).refreshToken).toBeUndefined();
      expect(body<AuthBody>(res).accessToken).toBeDefined();
      extractRefreshCookie(res); // throws if missing
    });

    it('refreshes using the cookie, rotates it, and rejects the old cookie on reuse', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `cookierotate_${stamp}@test.com`,
          password: 'password123',
          name: 'Cookie Rotate',
          phone: '0700000005',
          role: 'PASSENGER',
        })
        .expect(201);
      const originalCookie = extractRefreshCookie(registerRes);

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(201);
      expect(body<AuthBody>(refreshRes).accessToken).toBeDefined();
      const rotatedCookie = extractRefreshCookie(refreshRes);
      expect(rotatedCookie).not.toBe(originalCookie);

      // The original cookie was single-use — reusing it should now fail.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(401);

      // The rotated cookie should still work until it's used or logged out.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', rotatedCookie)
        .expect(201);
    }, 45000);

    it('logout invalidates the refresh cookie server-side', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `cookielogout_${stamp}@test.com`,
          password: 'password123',
          name: 'Cookie Logout',
          phone: '0700000006',
          role: 'PASSENGER',
        })
        .expect(201);
      const cookie = extractRefreshCookie(registerRes);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookie)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    }, 30000);

    it('rejects /auth/refresh with no cookie at all', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });

  describe('account lockout after repeated failed logins', () => {
    it('locks the account after 10 failed attempts, even with the correct password', async () => {
      const email = `lockout_${stamp}@test.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          password: 'password123',
          name: 'Lockout Test',
          phone: '0700000007',
          role: 'PASSENGER',
        })
        .expect(201);

      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'password123' })
        .expect(401);
      expect(body<ErrorBody>(res).message).toMatch(/temporarily locked/i);
    }, 60000);
  });

  describe('phone number field encryption', () => {
    it('stores the phone encrypted at rest but returns it decrypted via the API', async () => {
      const email = `phoneenc_${stamp}@test.com`;
      const plainPhone = '0700000008';
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          password: 'password123',
          name: 'Phone Encryption Test',
          phone: plainPhone,
          role: 'PASSENGER',
        })
        .expect(201);

      const rawUser = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(rawUser.phone).not.toBe(plainPhone);
      expect(rawUser.phone?.startsWith('enc:')).toBe(true);

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set(
          'Authorization',
          `Bearer ${body<AuthBody>(registerRes).accessToken}`,
        )
        .expect(200);
      expect(body<ProfileBody>(me).phone).toBe(plainPhone);
    }, 15000);
  });

  describe('full trip + cash payment lifecycle', () => {
    let passengerToken: string;
    let driverToken: string;
    let driverUserId: string;
    let driverId: string;
    let adminToken: string;
    let tripId: string;

    beforeAll(async () => {
      const passengerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `passenger_${stamp}@test.com`,
          password: 'password123',
          name: 'Test Passenger',
          phone: '0700000001',
          role: 'PASSENGER',
        })
        .expect(201);
      passengerToken = body<AuthBody>(passengerRes).accessToken;

      const driverRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `driver_${stamp}@test.com`,
          password: 'password123',
          name: 'Test Driver',
          phone: '0700000002',
          role: 'DRIVER',
        })
        .expect(201);
      driverToken = body<AuthBody>(driverRes).accessToken;
      driverUserId = body<AuthBody>(driverRes).user.id;

      await request(app.getHttpServer())
        .post('/drivers/me/vehicle')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          make: 'Toyota',
          model: 'Corolla',
          color: 'White',
          plateNumber: `UAX${stamp % 1000}E2E`,
          rideType: 'ECONOMY',
        })
        .expect(201);

      // Bootstrap an admin directly via Prisma rather than depending on a manually
      // seeded account, so this test is self-contained.
      const adminEmail = `admin_${stamp}@test.com`;
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash: await bcrypt.hash('password123', 10),
          name: 'Test Admin',
          role: UserRole.ADMIN,
        },
      });
      const adminLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: 'password123' })
        .expect(201);
      adminToken = body<AuthBody>(adminLogin).accessToken;

      // This admin was seeded with a legacy bcrypt hash — a successful login should have
      // transparently upgraded it to Argon2id (Argon2id hashes never start with "$2").
      const upgradedAdmin = await prisma.user.findUniqueOrThrow({
        where: { email: adminEmail },
      });
      expect(upgradedAdmin.passwordHash?.startsWith('$2')).toBe(false);
      // The new hash must still authenticate the same password.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password: 'password123' })
        .expect(201);

      const pending = await request(app.getHttpServer())
        .get('/drivers/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const pendingDriver = body<PendingDriverBody[]>(pending).find(
        (d) => d.userId === driverUserId,
      );
      driverId = pendingDriver!.id;
      await request(app.getHttpServer())
        .patch(`/drivers/${driverId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch('/drivers/me/availability')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ isOnline: true })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/drivers/me/location')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ lat: 0.3476, lng: 32.5825 })
        .expect(200);

      const tripRes = await request(app.getHttpServer())
        .post('/trips')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({
          pickupLat: 0.3476,
          pickupLng: 32.5825,
          pickupAddress: 'Kampala Rd',
          destinationLat: 0.365,
          destinationLng: 32.595,
          destinationAddress: 'Ntinda',
          rideType: 'ECONOMY',
          paymentMethod: 'CASH',
        })
        .expect(201);
      tripId = body<TripRequestBody>(tripRes).trip.id;
    }, 60000);

    it('accepts the trip for the first driver', async () => {
      await request(app.getHttpServer())
        .patch(`/trips/${tripId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
    });

    it('rejects a second accept on an already-accepted trip (race-condition fix)', async () => {
      await request(app.getHttpServer())
        .patch(`/trips/${tripId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(400);
    });

    it('rejects fetching trip details for a user not part of the trip (IDOR fix)', async () => {
      const outsiderRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `outsider_${stamp}@test.com`,
          password: 'password123',
          name: 'Outsider',
          phone: '0700000003',
          role: 'PASSENGER',
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/trips/${tripId}`)
        .set(
          'Authorization',
          `Bearer ${body<AuthBody>(outsiderRes).accessToken}`,
        )
        .expect(403);

      // The actual passenger on the trip should still be able to fetch it.
      await request(app.getHttpServer())
        .get(`/trips/${tripId}`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .expect(200);
    });

    it('runs the trip through to completion', async () => {
      for (const status of ['ARRIVED', 'IN_PROGRESS', 'COMPLETED']) {
        await request(app.getHttpServer())
          .patch(`/trips/${tripId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status })
          .expect(200);
      }
    });

    it('does not credit the driver wallet before cash payment is confirmed', async () => {
      const wallet = await request(app.getHttpServer())
        .get('/wallet/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
      expect(body<WalletBody>(wallet).balance).toBe(0);
    });

    it('credits the driver wallet once the passenger confirms cash payment', async () => {
      await request(app.getHttpServer())
        .post(`/payments/${tripId}/cash/confirm`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .expect(201);

      const wallet = await request(app.getHttpServer())
        .get('/wallet/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
      expect(body<WalletBody>(wallet).balance).toBeGreaterThan(0);
    });

    it('rejects confirming the same cash payment twice', async () => {
      await request(app.getHttpServer())
        .post(`/payments/${tripId}/cash/confirm`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .expect(400);
    });
  });
});
