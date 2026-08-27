import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import * as fs from 'fs';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { MediaLibraryService } from './media-library.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { GetLogsQueryDto } from './dto/get-logs-query.dto.js';
import { RetryFailedDto } from './dto/retry-failed.dto.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';

const ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

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
  @ApiOperation({ summary: 'Upload one media file to Google Drive and queue Meta Ads upload' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
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
    @UploadedFile() file: Express.Multer.File,
  ) {
    const adAccount = await this.adAccounts.findByAdAccountId(dto.adAccountId);
    if (adAccount.clientId !== dto.clientId) {
      throw new ForbiddenException('Ad account does not belong to the specified client');
    }
    try {
      return await this.service.upload(dto, file);
    } finally {
      fs.unlink(file.path, () => {});
    }
  }

  @Get('logs')
  @ApiOperation({ summary: 'List upload history for a client' })
  async getLogs(@Query() query: GetLogsQueryDto) {
    return this.service.getLogs(
      query.clientId,
      query.page,
      query.limit,
      query.status,
      query.startDate,
      query.endDate,
      query.mediaName,
    );
  }

  // NOTE: this route must be declared BEFORE logs/:id/retry to avoid
  // 'retry-failed' being matched as the :id param
  @Post('logs/retry-failed')
  @ApiOperation({ summary: 'Re-enqueue all failed uploads for a client' })
  async retryFailed(@Body() dto: RetryFailedDto) {
    return this.service.retryFailed(dto.clientId);
  }

  @Post('logs/:id/retry')
  @ApiOperation({ summary: 'Re-enqueue a single failed upload' })
  async retryOne(@Param('id') id: string) {
    return this.service.retryOne(id);
  }
}
