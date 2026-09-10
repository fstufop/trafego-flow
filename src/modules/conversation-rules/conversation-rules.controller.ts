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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';

@ApiTags('conversation-rules')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('conversation-rules')
export class ConversationRulesController {
  constructor(private readonly rulesService: ConversationRulesService) {}

  @Get('posts')
  @ApiOperation({ summary: 'Listar posts recentes da página (para usar como triggerValue)' })
  @ApiQuery({ name: 'pageId', required: true, type: String })
  getPosts(@Query('pageId') pageId: string) {
    return this.rulesService.getRecentPosts(pageId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar regra de auto-reply' })
  create(@Body() dto: CreateConversationRuleDto) {
    return this.rulesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar regras ativas de um cliente' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.rulesService.findAll(clientId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar regra (reply, isActive, triggerValue)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationRuleDto) {
    return this.rulesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover regra (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rulesService.remove(id);
  }
}
