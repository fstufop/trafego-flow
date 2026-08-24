import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { MediaLibraryService } from './media-library.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';

const ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

// Evaluated at class definition time — read env directly
const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB ?? '500', 10)) * 1024 * 1024;

@ApiTags('media-library')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('media-library')
export class MediaLibraryController {
  constructor(
    private readonly service: MediaLibraryService,
    private readonly adAccounts: AdAccountsService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload media files to Google Drive and Meta Ads Manager' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
      fileFilter: (_req, file, cb) => {
        if (ACCEPTED_MIMES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Unsupported MIME type: ${file.mimetype}`), false);
        }
      },
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(
    @Body() dto: UploadMediaDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const adAccount = await this.adAccounts.findByAdAccountId(dto.adAccountId);
    if (adAccount.clientId !== dto.clientId) {
      throw new ForbiddenException('Ad account does not belong to the specified client');
    }

    try {
      return await this.service.upload(dto, files);
    } finally {
      for (const file of files) {
        fs.unlink(file.path, () => {});
      }
    }
  }
}
