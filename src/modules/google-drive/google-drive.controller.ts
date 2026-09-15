import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CreateDriveFolderDto } from './dto/create-drive-folder.dto.js';
import { GoogleDriveService } from './google-drive.service.js';

@ApiTags('Google Drive')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('google-drive')
export class GoogleDriveController {
  constructor(private readonly driveService: GoogleDriveService) {}

  @Post('folders')
  @ApiOperation({ summary: 'Cria uma pasta no Google Drive e retorna o link' })
  async createFolder(@Body() dto: CreateDriveFolderDto): Promise<{ folderUrl: string }> {
    const folderUrl = await this.driveService.createFolder(dto.name);
    return { folderUrl };
  }
}
