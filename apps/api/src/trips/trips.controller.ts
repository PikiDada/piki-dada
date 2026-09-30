import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TripsService } from './trips.service';
import { RequestTripDto } from './dto/request-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';
import { RateTripDto } from './dto/rate-trip.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('trips')
export class TripsController {
  constructor(private tripsService: TripsService) {}

  @Roles(UserRole.PASSENGER)
  @Post()
  request(@CurrentUser() user: { id: string }, @Body() dto: RequestTripDto) {
    return this.tripsService.requestTrip(user.id, dto);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/accept')
  accept(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tripsService.acceptTrip(user.id, id);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/reject')
  reject(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tripsService.rejectTrip(user.id, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateTripStatusDto,
  ) {
    return this.tripsService.updateStatus(user.id, id, dto);
  }

  @Post(':id/rate')
  rate(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: RateTripDto,
  ) {
    return this.tripsService.rateTrip(user.id, id, dto);
  }

  @Get('me')
  myTrips(@CurrentUser() user: { id: string; role: UserRole }) {
    return this.tripsService.myTrips(
      user.id,
      user.role === UserRole.DRIVER ? 'DRIVER' : 'PASSENGER',
    );
  }

  @Get(':id')
  getTrip(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tripsService.getTrip(user.id, id);
  }
}
