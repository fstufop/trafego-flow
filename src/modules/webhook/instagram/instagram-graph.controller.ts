import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard.js';
import { InstagramGraphService } from './instagram-graph.service.js';
import { InstagramFollowStatus } from './interfaces/instagram-graph.interface.js';

@ApiTags('webhook')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('webhook/instagram')
export class InstagramGraphController {
  constructor(private readonly graphService: InstagramGraphService) {}

  @Get('follow-status')
  @ApiOperation({
    summary:
      '[Debug] Check whether an Instagram user follows the professional account',
  })
  @ApiQuery({ name: 'pageId', required: true })
  @ApiQuery({ name: 'igsid', required: true })
  getFollowStatus(
    @Query('pageId') pageId: string,
    @Query('igsid') igsid: string,
  ): Promise<InstagramFollowStatus> {
    return this.graphService.getFollowStatus(pageId, igsid);
  }
}
