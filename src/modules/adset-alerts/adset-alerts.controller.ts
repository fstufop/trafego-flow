import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AdsetAlertsService } from './adset-alerts.service.js';

@ApiTags('adset-alerts')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('adset-alerts')
export class AdsetAlertsController {
  constructor(private readonly adsetAlertsService: AdsetAlertsService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disparar alerta de adsets manualmente (sem delay aleatório)',
  })
  async trigger(): Promise<{ triggered: boolean }> {
    await this.adsetAlertsService.triggerManual();
    return { triggered: true };
  }
}
