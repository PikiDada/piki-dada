import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { UserRole, VerificationTokenPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../notifications/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, isLegacyBcryptHash, verifyPassword } from './password-hash';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGIN_ATTEMPTS = 10;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  photoUrl?: string;
}

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private emailService: EmailService,
  ) {}

  async register(dto: RegisterDto, meta?: SessionMeta) {
    // Password hashing (Argon2id, deliberately CPU-expensive) doesn't depend on the
    // duplicate-email check, so run them concurrently rather than paying for both in
    // sequence -- this and the pairing below cut a slow, multi-round-trip endpoint down
    // to two round-trip pairs instead of four sequential ones.
    const [existing, passwordHash] = await Promise.all([
      this.usersService.findByEmail(dto.email),
      hashPassword(dto.password),
    ]);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone,
      role: dto.role,
    });
    this.emailService.sendWelcomeEmail(user.email, user.name);
    // Verification-token creation and session-token issuance are independent writes
    // that both only need user.id -- no reason to serialize them.
    const [, tokens] = await Promise.all([
      this.sendEmailVerification(user.id, user.email),
      this.issueTokens(user.id, user.email, user.role, meta),
    ]);
    return tokens;
  }

  private async createToken(userId: string, purpose: VerificationTokenPurpose, ttlMs: number) {
    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: { token, userId, purpose, expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeToken(token: string, purpose: VerificationTokenPurpose) {
    const record = await this.prisma.verificationToken.findUnique({ where: { token } });
    if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    await this.prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record;
  }

  async sendEmailVerification(userId: string, email: string) {
    const token = await this.createToken(
      userId,
      VerificationTokenPurpose.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_MS,
    );
    this.emailService.sendVerificationEmail(email, token);
  }

  async verifyEmail(token: string) {
    const record = await this.consumeToken(token, VerificationTokenPurpose.EMAIL_VERIFICATION);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { success: true };
  }

  async resendVerificationByEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    // Always return the same response whether or not the email exists/is already
    // verified, to avoid leaking which addresses are registered.
    if (user && !user.emailVerifiedAt) {
      await this.sendEmailVerification(user.id, user.email);
    }
    return { success: true };
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    // Always return the same response whether or not the email exists, to avoid leaking
    // which addresses are registered.
    if (user && user.passwordHash) {
      const token = await this.createToken(
        user.id,
        VerificationTokenPurpose.PASSWORD_RESET,
        PASSWORD_RESET_TTL_MS,
      );
      this.emailService.sendPasswordResetEmail(user.email, token);
    }
    return { success: true };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.consumeToken(token, VerificationTokenPurpose.PASSWORD_RESET);
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: record.userId },
      // Resetting the password is also a legitimate way to recover from a lockout.
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
    // Invalidate existing sessions so a stolen/old session can't outlive the password change.
    await this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } });
    return { success: true };
  }

  async login(dto: LoginDto, meta?: SessionMeta) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'This account is temporarily locked due to repeated failed login attempts. Try again later.',
      );
    }
    const matches = await verifyPassword(user.passwordHash, dto.password);
    if (!matches) {
      const attempts = user.failedLoginAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil:
            attempts >= MAX_FAILED_LOGIN_ATTEMPTS
              ? new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS)
              : null,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Please verify your email before logging in. Check your inbox or request a new verification link.',
      );
    }
    // Transparent upgrade: this is the only point we ever have the plaintext password again,
    // so a successful legacy-bcrypt verify is also our chance to re-hash with Argon2id.
    const upgradeHash = isLegacyBcryptHash(user.passwordHash)
      ? await hashPassword(dto.password)
      : undefined;
    if (user.failedLoginAttempts > 0 || upgradeHash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(upgradeHash ? { passwordHash: upgradeHash } : {}),
        },
      });
    }
    return this.issueTokens(user.id, user.email, user.role, meta);
  }

  async loginWithGoogle(
    profile: GoogleProfile,
    role: UserRole = UserRole.PASSENGER,
    meta?: SessionMeta,
  ) {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
    }
    if (!user) {
      user = await this.usersService.create({
        email: profile.email,
        googleId: profile.googleId,
        name: profile.name,
        photoUrl: profile.photoUrl,
        role,
      });
      // Google has already verified this email address, so there's no need to make
      // the user click a separate verification link.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    return this.issueTokens(user.id, user.email, user.role, meta);
  }

  async refresh(refreshToken: string, userId: string, meta?: SessionMeta) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });
    if (!stored || stored.userId !== userId || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return this.issueTokens(user.id, user.email, user.role, meta);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    return { success: true };
  }

  listSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { id: sessionId, userId } });
    return { success: true };
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { success: true };
  }

  private async issueTokens(
    userId: string,
    email: string,
    role: UserRole,
    meta?: SessionMeta,
  ) {
    const payload = { sub: userId, email, role };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: Number(this.config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN')),
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: Number(this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN')),
    });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
        userAgent: meta?.userAgent,
        ipAddress: meta?.ipAddress,
      },
    });
    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, role },
    };
  }
}
