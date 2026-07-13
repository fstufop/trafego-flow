import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard.js';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { TriggerDispatchDto } from './dto/trigger-dispatch.dto.js';

@ApiTags('report-dispatches')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('report-dispatches')
export class ReportDispatchesController {
  constructor(private readonly reportDispatchesService: ReportDispatchesService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disparar relatório semanal manualmente (cliente específico ou todos)' })
  trigger(@Body() dto: TriggerDispatchDto) {
    return this.reportDispatchesService.triggerForClient(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar histórico de despachos de um cliente' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findLogs(@Query('clientId') clientId: string) {
    return this.reportDispatchesService.findLogs(clientId);
  }
}
