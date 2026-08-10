import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AlertJobsService } from './alert-jobs.service.js';
import { CreateAlertJobDto } from './dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from './dto/update-alert-job.dto.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';

@ApiTags('alert-jobs')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('alert-jobs')
export class AlertJobsController {
  constructor(private readonly alertJobsService: AlertJobsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar jobs de alerta' })
  @ApiQuery({ name: 'status', required: false, enum: AlertJobStatus })
  @ApiQuery({ name: 'type', required: false, enum: AlertJobType })
  findAll(@Query('status') status?: AlertJobStatus, @Query('type') type?: AlertJobType) {
    return this.alertJobsService.findAll({ status, type });
  }

  @Post()
  @ApiOperation({ summary: 'Criar job de alerta' })
  create(@Body() dto: CreateAlertJobDto) {
    return this.alertJobsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar status e/ou fields de um job' })
  update(@Param('id') id: string, @Body() dto: UpdateAlertJobDto) {
    return this.alertJobsService.update(id, dto);
  }
}
