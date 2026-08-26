import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { MediaLibraryController } from './media-library.controller.js';
import { MediaLibraryService } from './media-library.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MetaMediaService } from './services/meta-media.service.js';
import { MetaUploadProcessor } from './processors/meta-upload.processor.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';

@Module({
  imports: [
    AdAccountsModule,
    ClientsModule,
    CryptoModule,
    TypeOrmModule.forFeature([MediaUploadLog]),
    BullModule.registerQueue({ name: 'media-upload' }),
  ],
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService, FileNamerService, GoogleDriveService, MetaMediaService, MetaUploadProcessor],
})
export class MediaLibraryModule {}
