import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { SameOriginGuard } from './guards/same-origin.guard';
import { CurrentUser } from './decorators/current-user.decorator';

const REFRESH_COOKIE_NAME = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  // The refresh token only ever travels as an httpOnly cookie, never in a JSON response body —
  // that way it's unreadable to JS even if an XSS bug is ever introduced elsewhere in the app.
  private setRefreshCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: Number(this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN')) * 1000,
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
  }

  private sessionMeta(req: Request) {
    return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.register(
      dto,
      this.sessionMeta(req),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.login(
      dto,
      this.sessionMeta(req),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @UseGuards(SameOriginGuard, JwtRefreshGuard)
  @Post('refresh')
  async refresh(
    @CurrentUser() current: { id: string; refreshToken: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.refresh(
      current.refreshToken,
      current.id,
      this.sessionMeta(req),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @UseGuards(SameOriginGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (token) await this.authService.logout(token);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  resendVerification(@CurrentUser() user: { id: string; email: string }) {
    return this.authService.sendEmailVerification(user.id, user.email);
  }

  // Unauthenticated variant: needed because a user blocked at login (unverified email)
  // has no JWT yet to call the guarded endpoint above.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('resend-verification-email')
  resendVerificationByEmail(@Body() dto: ForgotPasswordDto) {
    return this.authService.resendVerificationByEmail(dto.email);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: { id: string }) {
    return this.authService.listSessions(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.authService.revokeSession(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-all')
  async revokeAllSessions(
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.revokeAllSessions(user.id);
    this.clearRefreshCookie(res);
    return result;
  }

  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleAuth() {
    // Redirects to Google consent screen via passport strategy
  }

  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  async googleCallback(@Req() req, @Res() res: Response) {
    const tokens = await this.authService.loginWithGoogle(
      req.user,
      undefined,
      this.sessionMeta(req),
    );
    this.setRefreshCookie(res, tokens.refreshToken);
    const webUrl = this.config.get<string>('CORS_ORIGIN');
    const params = new URLSearchParams({ accessToken: tokens.accessToken });
    res.redirect(`${webUrl}/auth/callback?${params.toString()}`);
  }
}
