import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MapsPlatformService } from './maps-platform.service';

// Address suggestions from our own gazetteer. The booking pages ask this first and only fall
// back to Google Places when it has nothing, so every place we know saves a paid lookup.
@UseGuards(JwtAuthGuard)
@Controller('places')
export class PlacesController {
  constructor(private maps: MapsPlatformService) {}

  @Get('search')
  async search(@Query('q') q = '') {
    return { places: await this.maps.searchPlaces(q.slice(0, 200)) };
  }
}
