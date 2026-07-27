import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { CreateAdAccountDto } from './dto/create-ad-account.dto.js';
import { UpdateAdAccountDto } from './dto/update-ad-account.dto.js';
import { GetExpiringQueryDto } from './dto/get-expiring-query.dto.js';

@ApiTags('ad-accounts')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('ad-accounts')
export class AdAccountsController {
  constructor(private readonly adAccountsService: AdAccountsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a Meta Ads account for a client' })
  create(@Body() dto: CreateAdAccountDto) {
    return this.adAccountsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active ad accounts for a client' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.adAccountsService.findAll(clientId);
  }

  @Get('expiring')
  @ApiOperation({ summary: 'List ad accounts with tokens expiring soon' })
  findExpiring(@Query() query: GetExpiringQueryDto) {
    return this.adAccountsService.findExpiring(
      query.clientId,
      query.daysAhead ?? 7,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an ad account by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adAccountsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an ad account (rotate token or toggle active)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdAccountDto,
  ) {
    return this.adAccountsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete an ad account' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.adAccountsService.remove(id);
  }
}
