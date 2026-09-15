import { Module } from '@nestjs/common';
import { GoogleDriveController } from './google-drive.controller.js';
import { GoogleDriveService } from './google-drive.service.js';

@Module({
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
