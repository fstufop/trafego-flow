import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard.js';
import { WhatsAppSessionService } from './whatsapp-session.service.js';

@ApiTags('whatsapp-session')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('whatsapp-session')
export class WhatsAppSessionController {
  constructor(
    private readonly whatsAppSessionService: WhatsAppSessionService,
  ) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Retorna status da sessão WhatsApp e QR code se aguardando pareamento',
  })
  getStatus() {
    return this.whatsAppSessionService.getStatus();
  }

  @Get('pairing-code')
  @ApiOperation({
    summary:
      'Gera código de emparelhamento por número de telefone (alternativa ao QR)',
  })
  getPairingCode() {
    return this.whatsAppSessionService.getPairingCode();
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Lista todos os grupos em que o número dedicado participa',
  })
  listGroups() {
    return this.whatsAppSessionService.listGroups();
  }
}
