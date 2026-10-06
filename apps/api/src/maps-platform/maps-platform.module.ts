import { Global, Module } from '@nestjs/common';
import { MapsPlatformService } from './maps-platform.service';

@Global()
@Module({
  providers: [MapsPlatformService],
  exports: [MapsPlatformService],
})
export class MapsPlatformModule {}
