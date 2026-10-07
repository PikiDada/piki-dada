import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// Defense-in-depth for the cookie-driven /auth/refresh and /auth/logout endpoints: in
// production the refresh cookie is SameSite=None (required since the web app and API are on
// different domains), which means browsers will attach it to genuinely cross-site requests too.
// This blocks those by checking the Origin header matches our own frontend. Non-browser
// clients (no Origin header) are let through since they can't be CSRF'd via a browser anyway.
@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (!origin) return true;

    const allowedOrigin = this.config.getOrThrow<string>('CORS_ORIGIN');
    if (origin !== allowedOrigin) {
      throw new ForbiddenException('Cross-origin request blocked');
    }
    return true;
  }
}
