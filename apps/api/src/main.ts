import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { CorsIoAdapter } from './socket-io.adapter';
import { initSentry } from './sentry';

async function bootstrap() {
  initSentry();

  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
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
