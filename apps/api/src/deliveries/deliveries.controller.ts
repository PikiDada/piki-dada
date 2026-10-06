import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DeliveriesService } from './deliveries.service';
import { RequestDeliveryDto } from './dto/request-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { ReplaceDeliveryStopsDto } from './dto/delivery-stop-input.dto';
import { UploadsService } from '../uploads/uploads.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('deliveries')
export class DeliveriesController {
  constructor(
    private deliveriesService: DeliveriesService,
    private uploadsService: UploadsService,
  ) {}

  // Must come before ':id' below, or 'categories'/'size-tiers' would be parsed as an id.
  @Get('categories')
  listCategories() {
    return this.deliveriesService.listCategories();
  }

  @Get('size-tiers')
  listSizeTiers() {
    return this.deliveriesService.listSizeTiers();
  }

  // Separate from request() so the photo lands in storage (and gets a URL) before the
  // delivery itself is created — same two-step pattern as driver document uploads.
  @Roles(UserRole.PASSENGER)
  @Post('upload-photo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadItemPhoto(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const fileUrl = await this.uploadsService.uploadBuffer(
      file.buffer,
      'delivery-items',
      file.originalname,
      file.mimetype,
    );
    return { fileUrl };
  }

  @Roles(UserRole.PASSENGER)
  @Post()
  request(
    @CurrentUser() user: { id: string },
    @Body() dto: RequestDeliveryDto,
  ) {
    return this.deliveriesService.requestDelivery(user.id, dto);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/accept')
  accept(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.deliveriesService.acceptDelivery(user.id, id);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/reject')
  reject(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.deliveriesService.rejectDelivery(user.id, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateStatus(user.id, id, dto);
  }

  @Roles(UserRole.PASSENGER)
  @Post(':id/stops/preview')
  previewStops(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: ReplaceDeliveryStopsDto,
  ) {
    return this.deliveriesService.previewStops(user.id, id, dto);
  }

  @Roles(UserRole.PASSENGER)
  @Put(':id/stops')
  replaceStops(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: ReplaceDeliveryStopsDto,
  ) {
    return this.deliveriesService.replaceStops(user.id, id, dto);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/stops/:stopId/arrive')
  arriveAtStop(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('stopId') stopId: string,
  ) {
    return this.deliveriesService.arriveAtStop(user.id, id, stopId);
  }

  @Roles(UserRole.DRIVER)
  @Patch(':id/stops/:stopId/depart')
  departStop(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('stopId') stopId: string,
  ) {
    return this.deliveriesService.departStop(user.id, id, stopId);
  }

  // Must come before ':id' below, or 'me' would be parsed as an id.
  @Get('me')
  myDeliveries(@CurrentUser() user: { id: string; role: UserRole }) {
    return this.deliveriesService.myDeliveries(
      user.id,
      user.role === UserRole.DRIVER ? 'DRIVER' : 'PASSENGER',
    );
  }

  @Get(':id')
  getDelivery(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.deliveriesService.getDelivery(user.id, id);
  }
}
