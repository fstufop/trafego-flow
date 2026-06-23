import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard.js';
import { AdLibraryService } from './ad-library.service.js';
import { SearchAdLibraryDto } from './dto/search-ad-library.dto.js';
import type { AdLibrarySearchResult } from './interfaces/ad-library.interface.js';

@ApiTags('ad-library')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('ad-library')
export class AdLibraryController {
  constructor(private readonly adLibraryService: AdLibraryService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Busca anunciantes na Meta Ad Library',
    description:
      'Retorna lista deduplicada de anunciantes ativos na Meta por setor/termos. ' +
      'Dados públicos da Ad Library API. Uso: triagem manual para captação de clientes.',
  })
  search(@Query() dto: SearchAdLibraryDto): Promise<AdLibrarySearchResult> {
    return this.adLibraryService.search(dto);
  }
}
