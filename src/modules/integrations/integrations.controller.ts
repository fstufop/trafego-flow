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
import { IntegrationsService } from './integrations.service.js';
import { CreateIntegrationDto } from './dto/create-integration.dto.js';
import { UpdateIntegrationDto } from './dto/update-integration.dto.js';

@ApiTags('integrations')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a Meta integration for a client' })
  create(@Body() dto: CreateIntegrationDto) {
    return this.integrationsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active integrations for a client' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.integrationsService.findAll(clientId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an integration by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrationsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an integration (rotate token or toggle active)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete an integration' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrationsService.remove(id);
  }
}
