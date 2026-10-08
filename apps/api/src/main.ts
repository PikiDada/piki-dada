import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CorsIoAdapter } from './socket-io.adapter';
import { initSentry } from './sentry';

async function bootstrap() {
  initSentry();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // The API always sits behind a proxy (the shared server's front door and Piki Dada's own
  // Caddy, or Render's load balancer), so without this every visitor looks like the proxy:
  // one shared rate limit for everyone, and the proxy's address in the logs. Proxies on
  // private addresses are trusted to report the visitor in X-Forwarded-For; a value a visitor
  // sends themselves from the internet is not.
  app.set(
    'trust proxy',
    config.get<string>('TRUST_PROXY') ?? 'loopback, linklocal, uniquelocal',
  );
  const corsOrigin = config.getOrThrow<string>('CORS_ORIGIN');

  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.useWebSocketAdapter(new CorsIoAdapter(app, corsOrigin));

  await app.listen(config.get<number>('PORT') ?? 4000);
}
bootstrap().catch((err) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
