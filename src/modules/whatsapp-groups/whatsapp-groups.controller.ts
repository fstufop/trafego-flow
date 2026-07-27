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
import { WhatsAppGroupsService } from './whatsapp-groups.service.js';
import { CreateWhatsAppGroupDto } from './dto/create-whatsapp-group.dto.js';
import { UpdateWhatsAppGroupDto } from './dto/update-whatsapp-group.dto.js';

@ApiTags('whatsapp-groups')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('whatsapp-groups')
export class WhatsAppGroupsController {
  constructor(private readonly whatsAppGroupsService: WhatsAppGroupsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastrar grupo de WhatsApp para um cliente' })
  create(@Body() dto: CreateWhatsAppGroupDto) {
    return this.whatsAppGroupsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar grupos ativos de um cliente' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.whatsAppGroupsService.findAll(clientId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar label ou status de um grupo' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWhatsAppGroupDto,
  ) {
    return this.whatsAppGroupsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover grupo (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.whatsAppGroupsService.remove(id);
  }
}
