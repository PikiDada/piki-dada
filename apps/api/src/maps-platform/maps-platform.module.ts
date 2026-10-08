import { Global, Module } from '@nestjs/common';
import { MapsPlatformService } from './maps-platform.service';
import { PlacesController } from './places.controller';

@Global()
@Module({
  controllers: [PlacesController],
  providers: [MapsPlatformService],
  exports: [MapsPlatformService],
})
export class MapsPlatformModule {}
