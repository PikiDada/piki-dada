import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CouponsService } from './coupons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('coupons')
export class CouponsController {
  constructor(private coupons: CouponsService) {}

  @Roles(UserRole.PASSENGER)
  @Get('check')
  check(@CurrentUser() user: { id: string }, @Query('code') code = '') {
    return this.coupons.check(user.id, code);
  }
}
