import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PushService } from './push.service';
import {
  PushSubscriptionDto,
  UnsubscribeDto,
} from './dto/push-subscription.dto';

@Controller('push')
export class PushController {
  constructor(private pushService: PushService) {}

  @Get('public-key')
  getPublicKey() {
    return this.pushService.getPublicKey();
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() dto: PushSubscriptionDto,
  ) {
    return this.pushService.subscribe(dto, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unsubscribe')
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.pushService.unsubscribe(dto.endpoint);
  }
}
