import {
  BadRequestException,
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
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { MediaUploadAuthGuard } from '../../common/guards/media-upload-auth.guard.js';
import { MediaLibraryService } from './media-library.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto.js';
import { CompleteUploadSessionDto } from './dto/complete-upload-session.dto.js';
import { GetLogsQueryDto } from './dto/get-logs-query.dto.js';
import { RetryFailedDto } from './dto/retry-failed.dto.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ACCEPTED_MIMES } from './constants/accepted-mimes.constant.js';
import { MAX_FILE_SIZE_BYTES } from './constants/max-file-size.constant.js';

@ApiTags('media-library')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@Controller('media-library')
export class MediaLibraryController {
  constructor(
    private readonly service: MediaLibraryService,
    private readonly adAccounts: AdAccountsService,
  ) {}

  @Post('upload')
  @UseGuards(MediaUploadAuthGuard)
  @ApiOperation({
    summary:
      'Upload one media file to Google Drive and queue Meta Ads upload. ' +
      'Accepts either a normal session token or a short-lived media-upload-scoped ' +
      'token (see POST /auth/upload-token) — the dashboard calls this endpoint ' +
      "directly from the browser to avoid the Vercel proxy's request size limit.",
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, file, cb) =>
          cb(null, `${Date.now()}-${file.originalname}`),
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
    await this.assertAdAccountBelongsToClient(dto.adAccountId, dto.clientId);
    try {
      return await this.service.upload(dto, file);
    } finally {
      fs.unlink(file.path, () => {});
    }
  }

  @Post('upload-session')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary:
      'Start a direct browser-to-Google-Drive upload: returns a Drive resumable-upload ' +
      'session URL the dashboard PUTs the file bytes to directly, bypassing both the ' +
      "dashboard's own proxy and this API's request-size limits entirely.",
  })
  async createUploadSession(@Body() dto: CreateUploadSessionDto) {
    await this.assertAdAccountBelongsToClient(dto.adAccountId, dto.clientId);
    if (!ACCEPTED_MIMES.has(dto.mimeType)) {
      throw new BadRequestException(`Unsupported MIME type: ${dto.mimeType}`);
    }
    return this.service.createUploadSession(dto);
  }

  @Post('upload-complete')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary:
      'Confirm a direct browser-to-Drive upload (started via POST upload-session) finished, ' +
      'and queue the Meta Ads upload job.',
  })
  async completeUploadSession(@Body() dto: CompleteUploadSessionDto) {
    await this.assertAdAccountBelongsToClient(dto.adAccountId, dto.clientId);
    return this.service.completeUploadSession(dto);
  }

  private async assertAdAccountBelongsToClient(
    adAccountId: string,
    clientId: string,
  ): Promise<void> {
    const adAccount = await this.adAccounts.findByAdAccountId(adAccountId);
    if (adAccount.clientId !== clientId) {
      throw new ForbiddenException(
        'Ad account does not belong to the specified client',
      );
    }
  }

  @Get('logs')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Re-enqueue all failed uploads for a client' })
  async retryFailed(@Body() dto: RetryFailedDto) {
    return this.service.retryFailed(dto.clientId);
  }

  @Post('logs/:id/retry')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Re-enqueue a single failed upload' })
  async retryOne(@Param('id') id: string) {
    return this.service.retryOne(id);
  }
}
