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
import { DriversService } from './drivers.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UploadsService } from '../uploads/uploads.service';
import { AuditLogService } from '../audit-log/audit-log.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('drivers')
export class DriversController {
  constructor(
    private driversService: DriversService,
    private uploadsService: UploadsService,
    private auditLog: AuditLogService,
  ) {}

  @Roles(UserRole.DRIVER)
  @Get('me')
  getMe(@CurrentUser() user: { id: string }) {
    return this.driversService.getMyProfile(user.id);
  }

  @Roles(UserRole.DRIVER)
  @Post('me/vehicle')
  upsertVehicle(@CurrentUser() user: { id: string }, @Body() dto: CreateVehicleDto) {
    return this.driversService.upsertVehicle(user.id, dto);
  }

  @Roles(UserRole.DRIVER)
  @Post('me/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadDocument(
    @CurrentUser() user: { id: string },
    @Body() dto: UploadDocumentDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^(image\/(jpeg|png|webp)|application\/pdf)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const fileUrl = await this.uploadsService.uploadBuffer(file.buffer, 'driver-documents', file.originalname, file.mimetype);
    return this.driversService.addDocument(user.id, dto.type, fileUrl);
  }

  @Roles(UserRole.DRIVER)
  @Patch('me/availability')
  setAvailability(@CurrentUser() user: { id: string }, @Body() dto: UpdateAvailabilityDto) {
    return this.driversService.setAvailability(user.id, dto.isOnline);
  }

  @Roles(UserRole.DRIVER)
  @Patch('me/location')
  updateLocation(@CurrentUser() user: { id: string }, @Body() dto: UpdateLocationDto) {
    return this.driversService.updateLocation(user.id, dto.lat, dto.lng);
  }

  @Roles(UserRole.ADMIN)
  @Get('pending')
  listPending() {
    return this.driversService.listPendingApprovals();
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/approve')
  async approve(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.driversService.setApprovalStatus(id, 'APPROVED');
    await this.auditLog.log(admin.id, 'driver.approve', { type: 'Driver', id });
    return result;
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/reject')
  async reject(@CurrentUser() admin: { id: string }, @Param('id') id: string) {
    const result = await this.driversService.setApprovalStatus(id, 'REJECTED');
    await this.auditLog.log(admin.id, 'driver.reject', { type: 'Driver', id });
    return result;
  }
}
