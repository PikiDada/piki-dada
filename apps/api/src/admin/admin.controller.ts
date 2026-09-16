import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RideType, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { BroadcastPushDto } from './dto/broadcast-push.dto';
import { PushService } from '../push/push.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private adminService: AdminService,
    private pushService: PushService,
    private auditLog: AuditLogService,
  ) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('finance')
  getFinanceSummary() {
    return this.adminService.getFinanceSummary();
  }

  @Get('drivers/active')
  listActiveDrivers() {
    return this.adminService.listActiveDrivers();
  }

  @Get('users')
  listUsers(@Query('role') role?: UserRole) {
    return this.adminService.listUsers(role);
  }

  @Patch('users/:id/suspend')
  async suspendUser(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.adminService.setUserActive(id, false);
    await this.auditLog.log(admin.id, 'user.suspend', { type: 'User', id });
    return result;
  }

  @Patch('users/:id/activate')
  async activateUser(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.adminService.setUserActive(id, true);
    await this.auditLog.log(admin.id, 'user.activate', { type: 'User', id });
    return result;
  }

  @Delete('users/:id')
  async deleteUser(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    if (id === admin.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const result = await this.adminService.deleteUser(id);
    await this.auditLog.log(admin.id, 'user.delete', { type: 'User', id });
    return result;
  }

  @Patch('users/:id/promote')
  async promoteUser(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.adminService.promoteToAdmin(id);
    await this.auditLog.log(admin.id, 'user.promote', { type: 'User', id });
    return result;
  }

  @Get('trips')
  listTrips() {
    return this.adminService.listTrips();
  }

  @Get('pricing')
  listPricing() {
    return this.adminService.listPricingRules();
  }

  @Patch('pricing/:rideType')
  async upsertPricing(
    @CurrentUser() admin: { id: string },
    @Param('rideType') rideType: RideType,
    @Body() dto: UpsertPricingRuleDto,
  ) {
    const result = await this.adminService.upsertPricingRule(
      rideType as 'ECONOMY' | 'COMFORT' | 'BODA',
      dto,
    );
    await this.auditLog.log(admin.id, 'pricing.upsert', { type: 'PricingRule', id: rideType }, { ...dto });
    return result;
  }

  @Get('coupons')
  listCoupons() {
    return this.adminService.listCoupons();
  }

  @Post('coupons')
  async createCoupon(@CurrentUser() admin: { id: string }, @Body() dto: CreateCouponDto) {
    const result = await this.adminService.createCoupon(dto);
    await this.auditLog.log(admin.id, 'coupon.create', { type: 'Coupon', id: result.id }, { ...dto });
    return result;
  }

  @Patch('coupons/:id/deactivate')
  async deactivateCoupon(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.adminService.setCouponActive(id, false);
    await this.auditLog.log(admin.id, 'coupon.deactivate', { type: 'Coupon', id });
    return result;
  }

  @Post('push/broadcast')
  async broadcastPush(@CurrentUser() admin: { id: string }, @Body() dto: BroadcastPushDto) {
    const result = await this.pushService.broadcast(dto.title, dto.body, dto.url);
    await this.auditLog.log(admin.id, 'push.broadcast', undefined, { ...dto });
    return result;
  }

  @Get('push/history')
  pushHistory() {
    return this.pushService.listBroadcastHistory();
  }

  @Get('documents/:id')
  async proxyDocument(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminService.getDocumentFile(id);

    const isLegacyImagePdf =
      /\.pdf$/i.test(doc.fileUrl) && doc.fileUrl.includes('/image/upload/');

    // For legacy image-pipeline PDFs, insert fl_attachment to ask Cloudinary
    // to serve the original PDF bytes rather than a rasterised image.
    // If that request fails, fall back to stripping the extension so Cloudinary
    // returns a JPEG render of the first page (always available).
    let buffer: Buffer;
    let contentType: string;
    let ext: string;

    if (isLegacyImagePdf) {
      const attachUrl = doc.fileUrl.replace('/image/upload/', '/image/upload/fl_attachment/');
      const attempt = await fetch(attachUrl);
      if (attempt.ok && attempt.headers.get('content-type')?.includes('pdf')) {
        buffer = Buffer.from(await attempt.arrayBuffer());
        contentType = 'application/pdf';
        ext = 'pdf';
      } else {
        // fl_attachment didn't return a PDF — fall back to JPEG render
        const jpegUrl = doc.fileUrl.replace(/\.pdf$/i, '');
        const fallback = await fetch(jpegUrl);
        if (!fallback.ok) {
          console.error(`[document-proxy] fallback ${fallback.status} for doc ${id}: ${jpegUrl}`);
          throw new NotFoundException('File could not be fetched from storage');
        }
        buffer = Buffer.from(await fallback.arrayBuffer());
        contentType = fallback.headers.get('content-type') ?? 'image/jpeg';
        ext = 'jpg';
      }
    } else {
      const upstream = await fetch(doc.fileUrl);
      if (!upstream.ok) {
        console.error(`[document-proxy] ${upstream.status} for doc ${id}: ${doc.fileUrl}`);
        throw new NotFoundException('File could not be fetched from storage');
      }
      buffer = Buffer.from(await upstream.arrayBuffer());
      contentType = upstream.headers.get('content-type') ?? 'application/pdf';
      ext = (doc.fileUrl.match(/\.(pdf|jpe?g|png|webp)$/i)?.[1] ?? 'bin').toLowerCase();
    }

    const label = doc.type
      .split('_')
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('_');

    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `inline; filename="${label}.${ext}"`);
    res.set('Cache-Control', 'private, max-age=3600');

    return new StreamableFile(buffer);
  }
}
