import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { decryptUserPhone } from '../common/field-encryption';

class FcmTokenDto {
  @IsString()
  fcmToken: string;
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: { id: string }) {
    const found = await this.usersService.findById(user.id);
    if (!found) return found;
    const { passwordHash, ...safeUser } = found;
    return decryptUserPhone(safeUser);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.id, dto);
    const { passwordHash, ...safeUser } = updated;
    return decryptUserPhone(safeUser);
  }

  @Patch('me/fcm-token')
  setFcmToken(@CurrentUser() user: { id: string }, @Body() dto: FcmTokenDto) {
    return this.usersService.setFcmToken(user.id, dto.fcmToken);
  }
}
